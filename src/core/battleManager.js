
battle_manager = """const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

class BattleManager {
    constructor(db, gameEngine) {
        this.db = db;
        this.game = gameEngine;
        this.activeBattles = new Map();
        this.pvpQueue = [];
        this.groupBattles = new Map();
    }

    // PvE Battle Management
    async startPvEBattle(player, chatJid) {
        const enemy = this.game.getRandomEnemy();
        const battleId = uuidv4();
        
        const battle = {
            id: battleId,
            type: 'pve',
            player: player,
            enemy: enemy,
            playerHp: player.hp,
            enemyHp: enemy.current_hp,
            maxPlayerHp: player.max_hp,
            maxEnemyHp: enemy.current_hp,
            turn: 1,
            chatJid: chatJid,
            messageId: null,
            lastAction: null,
            status: 'active',
            createdAt: moment()
        };

        this.activeBattles.set(player.phone, battle);
        
        // Save to database for persistence
        await this.db.createActiveBattle(player.phone, {
            type: 'pve',
            enemy: enemy,
            playerHp: player.hp,
            enemyHp: enemy.current_hp,
            messageId: null,
            chatJid: chatJid
        });

        return battle;
    }

    async processBattleAction(phone, action) {
        const battle = this.activeBattles.get(phone);
        if (!battle) return { error: 'No active battle' };

        const result = {
            battle: battle,
            action: action,
            damageDealt: 0,
            damageTaken: 0,
            healed: 0,
            fled: false,
            won: false,
            lost: false,
            message: ''
        };

        // Process player action
        switch(action) {
            case 'attack':
                result.damageDealt = this.game.calculateDamage(battle.player, null, false, false);
                battle.enemyHp -= result.damageDealt;
                result.message = `⚔️ You attacked for ${result.damageDealt} damage!`;
                break;

            case 'special':
                result.damageDealt = this.game.calculateDamage(battle.player, null, false, true);
                battle.enemyHp -= result.damageDealt;
                result.message = `💥 SPECIAL ATTACK! You dealt ${result.damageDealt} damage!`;
                break;

            case 'defend':
                result.message = `🛡️ You take a defensive stance!`;
                break;

            case 'heal':
                const healAmount = Math.floor(battle.maxPlayerHp * 0.3);
                battle.playerHp = Math.min(battle.maxPlayerHp, battle.playerHp + healAmount);
                result.healed = healAmount;
                result.message = `💚 You healed ${healAmount} HP!`;
                break;

            case 'flee':
                if (Math.random() < 0.6) {
                    result.fled = true;
                    result.message = `🏃 You successfully fled from battle!`;
                    await this.endBattle(phone, 'fled');
                    return result;
                } else {
                    result.message = `❌ Failed to flee!`;
                }
                break;
        }

        // Check if enemy defeated
        if (battle.enemyHp <= 0) {
            result.won = true;
            result.message += `\\n\\n🎉 VICTORY! You defeated ${battle.enemy.name}!`;
            await this.endBattle(phone, 'won');
            return result;
        }

        // Enemy counter-attack (unless defending)
        if (!result.fled) {
            const isDefending = action === 'defend';
            result.damageTaken = this.game.calculateEnemyDamage(battle.enemy, isDefending);
            battle.playerHp -= result.damageTaken;
            
            if (result.damageTaken > 0) {
                result.message += `\\n👹 ${battle.enemy.name} attacks for ${result.damageTaken} damage!`;
            } else {
                result.message += `\\n🛡️ You blocked the attack!`;
            }
        }

        // Check if player defeated
        if (battle.playerHp <= 0) {
            result.lost = true;
            result.message += `\\n\\n💀 DEFEAT! You were knocked out!`;
            await this.endBattle(phone, 'lost');
            return result;
        }

        // Update battle state
        battle.turn++;
        battle.lastAction = action;
        await this.updateBattleState(phone, battle);

        // Add status to message
        result.message += `\\n\\n📊 *Battle Status* (Turn ${battle.turn})\\n`;
        result.message += `❤️ You: ${battle.playerHp}/${battle.maxPlayerHp} HP\\n`;
        result.message += `👹 ${battle.enemy.name}: ${battle.enemyHp}/${battle.maxEnemyHp} HP`;

        return result;
    }

    async endBattle(phone, outcome) {
        const battle = this.activeBattles.get(phone);
        if (!battle) return null;

        const rewards = { points: 0, exp: 0 };

        if (outcome === 'won') {
            const calcRewards = this.game.calculateBattleRewards(battle.enemy, battle.player.level);
            rewards.points = calcRewards.points;
            rewards.exp = calcRewards.exp;

            // Update player stats
            await this.db.updatePlayer(phone, {
                points: battle.player.points + rewards.points,
                exp: battle.player.exp + rewards.exp,
                wins: battle.player.wins + 1
            });

            // Check level up
            const expNeeded = this.game.calculateLevelUpExp(battle.player.level);
            if (battle.player.exp + rewards.exp >= expNeeded) {
                await this.db.updatePlayer(phone, {
                    level: battle.player.level + 1,
                    power: battle.player.power + 5,
                    max_hp: battle.player.max_hp + 20,
                    hp: battle.player.max_hp + 20,
                    exp: 0
                });
                rewards.leveledUp = true;
            }
        } else if (outcome === 'lost') {
            await this.db.updatePlayer(phone, {
                losses: battle.player.losses + 1,
                hp: 0
            });
        }

        // Cleanup
        this.activeBattles.delete(phone);
        await this.db.deleteActiveBattle(phone);

        return { battle, outcome, rewards };
    }

    async updateBattleState(phone, battle) {
        await this.db.updateBattle(phone, {
            player_hp: battle.playerHp,
            enemy_hp: battle.enemyHp,
            turn: battle.turn,
            last_action: battle.lastAction
        });
    }

    getBattle(phone) {
        return this.activeBattles.get(phone);
    }

    // PvP Battle Management
    async findPvPMatch(player) {
        // Check cooldown
        if (player.last_pvp) {
            const minutesSince = moment().diff(moment(player.last_pvp), 'minutes');
            if (minutesSince < parseInt(process.env.PVP_COOLDOWN_MINUTES || 10)) {
                return { error: `Cooldown: ${parseInt(process.env.PVP_COOLDOWN_MINUTES || 10) - minutesSince} minutes remaining` };
            }
        }

        // Look for opponent in queue
        const opponentIndex = this.pvpQueue.findIndex(p => p.phone !== player.phone);
        
        if (opponentIndex === -1) {
            // Add to queue
            this.pvpQueue.push(player);
            return { queued: true };
        }

        // Match found
        const opponent = this.pvpQueue.splice(opponentIndex, 1)[0];
        return this.startPvPMatch(player, opponent);
    }

    async startPvPMatch(player1, player2) {
        const battleId = uuidv4();
        
        const battle = {
            id: battleId,
            type: 'pvp',
            player1: { ...player1, currentHp: player1.hp },
            player2: { ...player2, currentHp: player2.hp },
            turn: 1,
            currentPlayer: player1.phone,
            status: 'active',
            actions: {},
            createdAt: moment()
        };

        this.activeBattles.set(player1.phone, battle);
        this.activeBattles.set(player2.phone, battle);

        return { battle, opponent: player2 };
    }

    async processPvPTurn(phone, action) {
        const battle = this.activeBattles.get(phone);
        if (!battle || battle.type !== 'pvp') return { error: 'No active PvP battle' };

        if (battle.currentPlayer !== phone) {
            return { error: 'Not your turn' };
        }

        // Store action
        battle.actions[phone] = action;

        // Check if both players acted
        const players = [battle.player1.phone, battle.player2.phone];
        const bothActed = players.every(p => battle.actions[p]);

        if (!bothActed) {
            return { waiting: true, message: 'Action recorded! Waiting for opponent...' };
        }

        // Resolve turn
        return this.resolvePvPTurn(battle);
    }

    async resolvePvPTurn(battle) {
        const p1 = battle.player1;
        const p2 = battle.player2;
        const p1Action = battle.actions[p1.phone];
        const p2Action = battle.actions[p2.phone];

        let result = {
            p1Damage: 0,
            p2Damage: 0,
            p1Healed: 0,
            p2Healed: 0,
            messages: [],
            winner: null
        };

        // Process actions
        // Player 1 action
        if (p1Action === 'attack') {
            const isDefending = p2Action === 'defend';
            result.p2Damage = this.game.calculateDamage(p1, p2, isDefending, false);
            p2.currentHp -= result.p2Damage;
            result.messages.push(`${p1.name} attacks for ${result.p2Damage} damage!`);
        } else if (p1Action === 'special') {
            const isDefending = p2Action === 'defend';
            result.p2Damage = this.game.calculateDamage(p1, p2, isDefending, true);
            p2.currentHp -= result.p2Damage;
            result.messages.push(`${p1.name} uses SPECIAL for ${result.p2Damage} damage!`);
        } else if (p1Action === 'heal') {
            result.p1Healed = Math.floor(p1.max_hp * 0.25);
            p1.currentHp = Math.min(p1.hp, p1.currentHp + result.p1Healed);
            result.messages.push(`${p1.name} heals ${result.p1Healed} HP!`);
        } else if (p1Action === 'defend') {
            result.messages.push(`${p1.name} takes a defensive stance!`);
        }

        // Player 2 action (if not defeated)
        if (p2.currentHp > 0) {
            if (p2Action === 'attack') {
                const isDefending = p1Action === 'defend';
                result.p1Damage = this.game.calculateDamage(p2, p1, isDefending, false);
                p1.currentHp -= result.p1Damage;
                result.messages.push(`${p2.name} attacks for ${result.p1Damage} damage!`);
            } else if (p2Action === 'special') {
                const isDefending = p1Action === 'defend';
                result.p1Damage = this.game.calculateDamage(p2, p1, isDefending, true);
                p1.currentHp -= result.p1Damage;
                result.messages.push(`${p2.name} uses SPECIAL for ${result.p1Damage} damage!`);
            } else if (p2Action === 'heal') {
                result.p2Healed = Math.floor(p2.max_hp * 0.25);
                p2.currentHp = Math.min(p2.hp, p2.currentHp + result.p2Healed);
                result.messages.push(`${p2.name} heals ${result.p2Healed} HP!`);
            } else if (p2Action === 'defend') {
                result.messages.push(`${p2.name} takes a defensive stance!`);
            }
        }

        // Check for winner
        if (p1.currentHp <= 0 || p2.currentHp <= 0) {
            if (p1.currentHp <= 0 && p2.currentHp <= 0) {
                result.winner = 'draw';
                result.messages.push('\\n🤝 It\\'s a draw!');
            } else if (p2.currentHp <= 0) {
                result.winner = p1.phone;
                result.messages.push(`\\n🏆 ${p1.name} wins!`);
                await this.endPvPMatch(battle, p1, p2);
            } else {
                result.winner = p2.phone;
                result.messages.push(`\\n🏆 ${p2.name} wins!`);
                await this.endPvPMatch(battle, p2, p1);
            }
        } else {
            // Next turn
            battle.turn++;
            battle.currentPlayer = battle.currentPlayer === p1.phone ? p2.phone : p1.phone;
            battle.actions = {};
            result.messages.push(`\\n📊 Turn ${battle.turn} - ${battle.currentPlayer === p1.phone ? p1.name : p2.name}\\'s turn`);
        }

        return result;
    }

    async endPvPMatch(battle, winner, loser) {
        // Calculate ELO changes
        const eloChanges = this.game.calculateEloChange(winner.elo_rating, loser.elo_rating);
        
        // Update winner
        const newWinnerElo = winner.elo_rating + eloChanges.winnerChange;
        const winnerRank = this.game.getRankTier(newWinnerElo);
        
        await this.db.updatePlayer(winner.phone, {
            pvp_wins: winner.pvp_wins + 1,
            elo_rating: newWinnerElo,
            rank_tier: winnerRank.tier,
            last_pvp: moment().toISOString()
        });

        // Update loser
        const newLoserElo = Math.max(0, loser.elo_rating + eloChanges.loserChange);
        const loserRank = this.game.getRankTier(newLoserElo);
        
        await this.db.updatePlayer(loser.phone, {
            pvp_losses: loser.pvp_losses + 1,
            elo_rating: newLoserElo,
            rank_tier: loserRank.tier,
            last_pvp: moment().toISOString()
        });

        // Record match
        await this.db.recordPvPMatch(
            winner.phone,
            loser.phone,
            winner.phone,
            winner.currentHp,
            loser.currentHp,
            eloChanges.winnerChange
        );

        // Cleanup
        this.activeBattles.delete(winner.phone);
        this.activeBattles.delete(loser.phone);

        return {
            winnerEloChange: eloChanges.winnerChange,
            loserEloChange: eloChanges.loserChange
        };
    }

    removeFromQueue(phone) {
        const index = this.pvpQueue.findIndex(p => p.phone === phone);
        if (index > -1) {
            this.pvpQueue.splice(index, 1);
        }
    }

    // Group Battle Management
    async createGroupBattle(creator, groupJid, enemyName = null) {
        const enemy = enemyName ? 
            Object.values(this.config.enemies.epic).find(e => e.name.toLowerCase() === enemyName.toLowerCase()) :
            this.config.bosses?.world_bosses[Math.floor(Math.random() * this.config.bosses.world_bosses.length)];

        if (!enemy) return { error: 'Invalid enemy' };

        const hp = enemy.base_hp || enemy.max_hp || 10000;
        const battleId = await this.db.createGroupBattle(creator.phone, groupJid, {
            enemyName: enemy.name || enemy.boss_name,
            enemyHp: hp,
            maxPlayers: 5,
            rewards: enemy.rewards || { points_min: 5000, points_max: 10000 }
        });

        const battle = {
            id: battleId,
            creator: creator.phone,
            groupJid: groupJid,
            enemy: { ...enemy, current_hp: hp, max_hp: hp },
            participants: [{ phone: creator.phone, name: creator.name }],
            status: 'waiting',
            createdAt: moment()
        };

        this.groupBattles.set(battleId, battle);

        // Auto-start after 60 seconds or when full
        setTimeout(() => this.startGroupBattle(battleId), 60000);

        return battle;
    }

    async joinGroupBattle(battleId, player) {
        const battle = this.groupBattles.get(battleId);
        if (!battle) return { error: 'Battle not found' };
        
        if (battle.status !== 'waiting') return { error: 'Battle already started' };
        if (battle.participants.find(p => p.phone === player.phone)) {
            return { error: 'Already joined' };
        }
        if (battle.participants.length >= 5) return { error: 'Battle is full' };

        await this.db.joinGroupBattle(battleId, player.phone);
        battle.participants.push({ phone: player.phone, name: player.name });

        // Start if full
        if (battle.participants.length >= 5) {
            await this.startGroupBattle(battleId);
        }

        return { success: true, battle };
    }

    async startGroupBattle(battleId) {
        const battle = this.groupBattles.get(battleId);
        if (!battle || battle.status !== 'waiting') return;

        battle.status = 'active';
        await this.db.updateGroupBattleStatus(battleId, 'active');

        return battle;
    }

    async processGroupAction(battleId, phone, action) {
        const battle = this.groupBattles.get(battleId);
        if (!battle || battle.status !== 'active') return { error: 'No active battle' };

        const player = await this.db.getPlayer(phone);
        let damage = 0;
        let message = '';

        switch(action) {
            case 'attack':
                damage = Math.floor((player.power || 10) * (0.8 + Math.random() * 0.4));
                message = `${player.name} attacks for ${damage} damage!`;
                break;
            case 'special':
                damage = Math.floor((player.power || 10) * 1.5 * (0.8 + Math.random() * 0.4));
                message = `${player.name} uses SPECIAL for ${damage} damage!`;
                break;
            case 'heal':
                message = `${player.name} heals the party!`;
                break;
        }

        if (damage > 0) {
            battle.enemy.current_hp -= damage;
            await this.db.updateGroupBattleDamage(battleId, phone, damage);
            await this.db.updateWorldBossHp(battleId, damage);
        }

        // Check if defeated
        if (battle.enemy.current_hp <= 0) {
            await this.endGroupBattle(battleId, true);
            return { victory: true, message, damage };
        }

        // Enemy counter-attack
        const livingPlayers = battle.participants.length;
        const enemyDamage = Math.floor(Math.random() * 50) + 30;
        
        return { 
            success: true, 
            message, 
            damage,
            enemyHp: battle.enemy.current_hp,
            enemyMaxHp: battle.enemy.max_hp,
            enemyDamage: `The ${battle.enemy.name} retaliates!`
        };
    }

    async endGroupBattle(battleId, victory) {
        const battle = this.groupBattles.get(battleId);
        if (!battle) return;

        battle.status = 'ended';
        await this.db.updateGroupBattleStatus(battleId, 'completed');

        if (victory) {
            // Distribute rewards
            const rewards = battle.enemy.rewards || { points_min: 5000, points_max: 10000 };
            const participants = await this.db.getGroupBattleParticipants(battleId);
            
            for (const p of participants) {
                const reward = Math.floor(Math.random() * (rewards.points_max - rewards.points_min)) + rewards.points_min;
                const player = await this.db.getPlayer(p.phone);
                await this.db.updatePlayer(p.phone, {
                    points: player.points + reward,
                    wins: player.wins + 1
                });
            }
        }

        this.groupBattles.delete(battleId);
    }

    getGroupBattle(battleId) {
        return this.groupBattles.get(battleId);
    }
}

module.exports = BattleManager;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/core/battleManager.js', 'w') as f:
    f.write(battle_manager)

print("✅ 7. src/core/battleManager.js created")