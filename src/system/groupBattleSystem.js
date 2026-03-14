
group_battle_system = """const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

class GroupBattleSystem {
    constructor(db, gameEngine) {
        this.db = db;
        this.game = gameEngine;
        this.activeBattles = new Map(); // groupJid -> battle
    }

    async createBattle(creator, groupJid, options = {}) {
        // Check if there's already an active battle in this group
        const existing = await this.db.getActiveGroupBattle(groupJid);
        if (existing) {
            return { error: 'There is already an active group battle in this group!' };
        }

        // Select enemy
        let enemy;
        if (options.bossName) {
            // Find specific boss
            const bosses = this.game.config.bosses?.world_bosses || [];
            enemy = bosses.find(b => b.name.toLowerCase() === options.bossName.toLowerCase());
        }
        
        if (!enemy) {
            // Random boss
            const bosses = this.game.config.bosses?.world_bosses || [
                { name: "World Ender", emoji: "🌑", base_hp: 50000, damage: "200-300", rewards: { points_min: 10000, points_max: 25000 } },
                { name: "Chaos Titan", emoji: "🗿", base_hp: 75000, damage: "300-450", rewards: { points_min: 20000, points_max: 50000 } }
            ];
            enemy = bosses[Math.floor(Math.random() * bosses.length)];
        }

        const battleId = uuidv4();
        const maxPlayers = options.maxPlayers || 5;
        const hp = enemy.base_hp || 50000;

        const battle = {
            id: battleId,
            groupJid: groupJid,
            creator: creator.phone,
            enemy: {
                name: enemy.name,
                emoji: enemy.emoji || '👹',
                hp: hp,
                maxHp: hp,
                damage: enemy.damage || "100-200"
            },
            participants: new Map(),
            maxPlayers: maxPlayers,
            status: 'waiting',
            turn: 0,
            rewards: enemy.rewards || { points_min: 5000, points_max: 10000 },
            createdAt: moment(),
            timeout: null
        };

        // Add creator as first participant
        battle.participants.set(creator.phone, {
            phone: creator.phone,
            name: creator.name,
            hp: creator.hp,
            maxHp: creator.max_hp,
            damageDealt: 0,
            healingDone: 0,
            joinedAt: moment()
        });

        // Save to database
        const dbBattleId = await this.db.createGroupBattle(creator.phone, groupJid, {
            enemyName: battle.enemy.name,
            enemyHp: hp,
            maxPlayers: maxPlayers,
            rewards: battle.rewards
        });
        battle.dbId = dbBattleId;

        this.activeBattles.set(groupJid, battle);

        // Auto-start after 60 seconds
        battle.timeout = setTimeout(() => {
            this.startBattle(groupJid);
        }, 60000);

        return {
            success: true,
            battle: battle,
            message: this.formatBattleCreated(battle, creator)
        };
    }

    formatBattleCreated(battle, creator) {
        let text = `👥 *GROUP BATTLE STARTED!* 👥\\n\\n`;
        text += `${battle.enemy.emoji} *${battle.enemy.name}* has appeared!\\n`;
        text += `❤️ HP: ${battle.enemy.hp.toLocaleString()}\\n`;
        text += `💀 Damage: ${battle.enemy.damage}\\n`;
        text += `👥 Max Players: ${battle.maxPlayers}\\n\\n`;
        text += `📢 *Join the battle!*\\n`;
        text += `Type /joingroup to join!\\n\\n`;
        text += `⏱️ Battle starts in 60 seconds!\\n`;
        text += `👑 Started by: ${creator.name}`;
        return text;
    }

    async joinBattle(groupJid, player) {
        const battle = this.activeBattles.get(groupJid);
        if (!battle) {
            return { error: 'No active group battle! Start one with /groupbattle' };
        }

        if (battle.status !== 'waiting') {
            return { error: 'Battle has already started!' };
        }

        if (battle.participants.has(player.phone)) {
            return { error: 'You already joined this battle!' };
        }

        if (battle.participants.size >= battle.maxPlayers) {
            return { error: 'Battle is full!' };
        }

        // Add participant
        battle.participants.set(player.phone, {
            phone: player.phone,
            name: player.name,
            hp: player.hp,
            maxHp: player.max_hp,
            damageDealt: 0,
            healingDone: 0,
            joinedAt: moment()
        });

        await this.db.joinGroupBattle(battle.dbId, player.phone);

        // Start immediately if full
        if (battle.participants.size >= battle.maxPlayers) {
            clearTimeout(battle.timeout);
            await this.startBattle(groupJid);
        }

        return {
            success: true,
            participants: battle.participants.size,
            maxPlayers: battle.maxPlayers,
            message: `✅ ${player.name} joined the battle! (${battle.participants.size}/${battle.maxPlayers})`
        };
    }

    async startBattle(groupJid) {
        const battle = this.activeBattles.get(groupJid);
        if (!battle || battle.status !== 'waiting') return;

        if (battle.participants.size < 2) {
            this.activeBattles.delete(groupJid);
            await this.db.updateGroupBattleStatus(battle.dbId, 'cancelled');
            return { error: 'Not enough players! Need at least 2.' };
        }

        battle.status = 'active';
        await this.db.updateGroupBattleStatus(battle.dbId, 'active');

        return {
            started: true,
            message: this.formatBattleStart(battle)
        };
    }

    formatBattleStart(battle) {
        let text = `⚔️ *BATTLE BEGINS!* ⚔️\\n\\n`;
        text += `${battle.enemy.emoji} *${battle.enemy.name}*\\n`;
        text += `${this.formatHealthBar(battle.enemy.hp, battle.enemy.maxHp)}\\n\\n`;
        text += `👥 *Raid Party (${battle.participants.size}):*\\n`;
        
        for (const [phone, p] of battle.participants) {
            text += `• ${p.name}\\n`;
        }
        
        text += `\\n🎮 *Commands:*\\n`;
        text += `/gattack - Attack the boss\\n`;
        text += `/gspecial - Special attack\\n`;
        text += `/gheal - Heal the party\\n`;
        text += `/gstatus - Check battle status`;
        
        return text;
    }

    async processAction(groupJid, phone, action) {
        const battle = this.activeBattles.get(groupJid);
        if (!battle) {
            return { error: 'No active group battle!' };
        }

        if (battle.status !== 'active') {
            return { error: 'Battle not active yet!' };
        }

        const participant = battle.participants.get(phone);
        if (!participant) {
            return { error: 'You are not in this battle! Join with /joingroup' };
        }

        const player = await this.db.getPlayer(phone);
        let result = {
            damage: 0,
            heal: 0,
            message: '',
            enemyDefeated: false
        };

        switch(action.toLowerCase()) {
            case 'attack':
                result.damage = this.calculateDamage(player);
                battle.enemy.hp -= result.damage;
                participant.damageDealt += result.damage;
                result.message = `${participant.name} ⚔️ attacks for *${result.damage.toLocaleString()}* damage!`;
                break;

            case 'special':
                result.damage = this.calculateDamage(player, true);
                battle.enemy.hp -= result.damage;
                participant.damageDealt += result.damage;
                result.message = `${participant.name} 💥 *SPECIAL ATTACK* for *${result.damage.toLocaleString()}* damage!`;
                break;

            case 'heal':
                result.heal = Math.floor(player.max_hp * 0.2);
                for (const p of battle.participants.values()) {
                    p.hp = Math.min(p.maxHp, p.hp + result.heal);
                }
                participant.healingDone += result.heal * battle.participants.size;
                result.message = `${participant.name} 💚 *HEALS THE PARTY* for ${result.heal} HP each!`;
                break;

            case 'status':
                return {
                    status: true,
                    message: this.formatBattleStatus(battle)
                };

            default:
                return { error: 'Invalid action! Use: attack, special, heal, or status' };
        }

        // Update database
        await this.db.updateGroupBattleDamage(battle.dbId, phone, result.damage);

        // Check if enemy defeated
        if (battle.enemy.hp <= 0) {
            result.enemyDefeated = true;
            result.message += `\\n\\n🎉 *VICTORY!* ${battle.enemy.name} has been defeated!`;
            await this.endBattle(groupJid, true);
            return result;
        }

        // Enemy counter-attack every 3 turns
        battle.turn++;
        if (battle.turn % 3 === 0) {
            const enemyAttack = this.processEnemyAttack(battle);
            result.message += `\\n\\n${enemyAttack.message}`;
            
            if (enemyAttack.allDefeated) {
                result.message += `\\n\\n💀 *DEFEAT!* The raid party was wiped out!`;
                await this.endBattle(groupJid, false);
                return result;
            }
        }

        // Add status
        result.message += `\\n\\n${battle.enemy.emoji} ${this.formatHealthBar(battle.enemy.hp, battle.enemy.maxHp)}`;

        return result;
    }

    calculateDamage(player, isSpecial = false) {
        let base = player.power || 10;
        
        // Add variance
        const variance = 0.8 + (Math.random() * 0.4);
        let damage = Math.floor(base * variance);
        
        if (isSpecial) damage = Math.floor(damage * 1.5);
        
        // Group bonus
        damage = Math.floor(damage * 1.2);
        
        return Math.max(1, damage);
    }

    processEnemyAttack(battle) {
        const [minDmg, maxDmg] = battle.enemy.damage.split('-').map(Number);
        const damagePerPlayer = Math.floor(Math.random() * (maxDmg - minDmg + 1)) + minDmg;
        
        let defeatedCount = 0;
        let totalDamage = 0;
        
        for (const participant of battle.participants.values()) {
            participant.hp -= damagePerPlayer;
            totalDamage += damagePerPlayer;
            
            if (participant.hp <= 0) {
                participant.hp = 0;
                defeatedCount++;
            }
        }

        const alivePlayers = battle.participants.size - defeatedCount;
        
        return {
            message: `👹 ${battle.enemy.name} attacks everyone for *${damagePerPlayer}* damage! (${alivePlayers} still standing)`,
            allDefeated: alivePlayers === 0,
            totalDamage: totalDamage
        };
    }

    formatBattleStatus(battle) {
        let text = `📊 *Group Battle Status*\\n\\n`;
        text += `${battle.enemy.emoji} *${battle.enemy.name}*\\n`;
        text += `${this.formatHealthBar(battle.enemy.hp, battle.enemy.maxHp)}\\n\\n`;
        text += `👥 *Raid Party:*\\n`;
        
        for (const p of battle.participants.values()) {
            const status = p.hp > 0 ? '❤️' : '💀';
            text += `${status} ${p.name}: ${p.hp}/${p.maxHp} HP\\n`;
            text += `   💥 Dealt: ${p.damageDealt.toLocaleString()} dmg\\n`;
        }
        
        return text;
    }

    formatHealthBar(current, max) {
        const percentage = Math.max(0, Math.floor((current / max) * 20));
        const filled = '█'.repeat(percentage);
        const empty = '░'.repeat(20 - percentage);
        const percent = Math.max(0, Math.floor((current / max) * 100));
        return `[${filled}${empty}] ${percent}% (${current.toLocaleString()}/${max.toLocaleString()})`;
    }

    async endBattle(groupJid, victory) {
        const battle = this.activeBattles.get(groupJid);
        if (!battle) return;

        battle.status = 'ended';
        await this.db.updateGroupBattleStatus(battle.dbId, victory ? 'victory' : 'defeat');

        if (victory) {
            // Distribute rewards
            const rewards = battle.rewards;
            const totalDamage = Array.from(battle.participants.values())
                .reduce((sum, p) => sum + p.damageDealt, 0);
            
            for (const participant of battle.participants.values()) {
                if (participant.hp <= 0) continue; // No reward if defeated
                
                const damagePercent = participant.damageDealt / totalDamage;
                const baseReward = Math.floor(Math.random() * 
                    (rewards.points_max - rewards.points_min + 1)) + rewards.points_min;
                const playerReward = Math.floor(baseReward * (0.5 + damagePercent));
                
                const player = await this.db.getPlayer(participant.phone);
                await this.db.updatePlayer(participant.phone, {
                    points: player.points + playerReward,
                    wins: player.wins + 1
                });
                
                // Send DM with reward
                // This would be handled by the bot instance
            }
        }

        this.activeBattles.delete(groupJid);
    }

    getBattle(groupJid) {
        return this.activeBattles.get(groupJid);
    }

    async leaveBattle(groupJid, phone) {
        const battle = this.activeBattles.get(groupJid);
        if (!battle) return { error: 'No active battle' };
        
        if (battle.status !== 'waiting') {
            return { error: 'Cannot leave after battle starts!' };
        }

        battle.participants.delete(phone);
        
        // Cancel if only creator left
        if (battle.participants.size === 0) {
            clearTimeout(battle.timeout);
            this.activeBattles.delete(groupJid);
            await this.db.updateGroupBattleStatus(battle.dbId, 'cancelled');
        }

        return { success: true };
    }
}

module.exports = GroupBattleSystem;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/systems/groupBattleSystem.js', 'w') as f:
    f.write(group_battle_system)

print("✅ 10. src/systems/groupBattleSystem.js created")