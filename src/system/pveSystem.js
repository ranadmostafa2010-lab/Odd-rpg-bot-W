
pve_system = """const moment = require('moment');

class PvESystem {
    constructor(db, gameEngine) {
        this.db = db;
        this.game = gameEngine;
    }

    async startBattle(player, chatJid) {
        // Check if player already in battle
        const existingBattle = await this.db.getActiveBattle(player.phone);
        if (existingBattle) {
            return { error: 'You already have an active battle! Finish it first.' };
        }

        // Check HP
        if (player.hp < 20) {
            return { error: 'Your HP is too low! Heal first with /heal or items.' };
        }

        const enemy = this.game.getRandomEnemy();
        const battleId = Date.now().toString(36);
        
        const battle = {
            id: battleId,
            type: 'pve',
            playerPhone: player.phone,
            playerName: player.name,
            playerHp: player.hp,
            playerMaxHp: player.max_hp,
            enemy: enemy,
            enemyHp: enemy.current_hp,
            enemyMaxHp: enemy.max_hp,
            turn: 1,
            chatJid: chatJid,
            status: 'active',
            createdAt: moment()
        };

        // Save to database
        await this.db.createActiveBattle(player.phone, {
            type: 'pve',
            enemy: enemy,
            playerHp: player.hp,
            enemyHp: enemy.current_hp,
            messageId: null,
            chatJid: chatJid
        });

        return {
            success: true,
            battle: battle,
            message: this.formatBattleStart(battle)
        };
    }

    formatBattleStart(battle) {
        let text = `⚔️ *BATTLE STARTED!* ⚔️\\n\\n`;
        text += `👹 Enemy: ${battle.enemy.emoji} *${battle.enemy.name}*\\n`;
        text += `❤️ Enemy HP: ${battle.enemyHp}/${battle.enemyMaxHp}\\n`;
        text += `💀 Damage: ${battle.enemy.damage}\\n`;
        text += `⭐ Rarity: ${battle.enemy.rarity.toUpperCase()}\\n\\n`;
        text += `📊 *Your Status*\\n`;
        text += `❤️ HP: ${battle.playerHp}/${battle.playerMaxHp}\\n`;
        text += `⚔️ Power: ${battle.playerPower || 'Base'}\\n\\n`;
        text += `🎮 *Choose your action:*\\n`;
        text += `1️⃣ /attack - Strike the enemy\\n`;
        text += `2️⃣ /defend - Block 70% damage\\n`;
        text += `3️⃣ /heal - Restore HP\\n`;
        text += `4️⃣ /flee - Try to escape (60%)\\n`;
        text += `5️⃣ /special - Special attack (if available)`;
        return text;
    }

    async processAction(phone, action) {
        const battle = await this.db.getActiveBattle(phone);
        if (!battle) {
            return { error: 'No active battle! Start one with /battle' };
        }

        const player = await this.db.getPlayer(phone);
        const enemy = JSON.parse(battle.enemy_data);
        
        let result = {
            action: action,
            damageDealt: 0,
            damageTaken: 0,
            healed: 0,
            fled: false,
            won: false,
            lost: false,
            messages: []
        };

        // Process player action
        switch(action.toLowerCase()) {
            case 'attack':
                result.damageDealt = this.calculatePlayerDamage(player);
                battle.enemy_hp -= result.damageDealt;
                result.messages.push(`⚔️ You attacked for *${result.damageDealt}* damage!`);
                break;

            case 'special':
                const equippedPet = await this.db.getEquippedPet(phone);
                if (!equippedPet) {
                    return { error: 'You need an equipped pet to use special attacks!' };
                }
                result.damageDealt = this.calculatePlayerDamage(player, true);
                battle.enemy_hp -= result.damageDealt;
                result.messages.push(`💥 *SPECIAL ATTACK!* Your ${equippedPet.name} dealt *${result.damageDealt}* damage!`);
                break;

            case 'defend':
                result.messages.push(`🛡️ You take a defensive stance! Incoming damage reduced by 70%.`);
                break;

            case 'heal':
                const healAmount = Math.floor(battle.player_hp * 0.3) + 20;
                const oldHp = battle.player_hp;
                battle.player_hp = Math.min(battle.player_max_hp, battle.player_hp + healAmount);
                result.healed = battle.player_hp - oldHp;
                result.messages.push(`💚 You healed *${result.healed}* HP!`);
                break;

            case 'flee':
                if (Math.random() < 0.6) {
                    result.fled = true;
                    result.messages.push(`🏃 You successfully fled from battle!`);
                    await this.endBattle(phone, 'fled', battle);
                    return result;
                } else {
                    result.messages.push(`❌ Failed to flee! The enemy blocks your path!`);
                }
                break;

            default:
                return { error: 'Invalid action! Use: attack, defend, heal, flee, or special' };
        }

        // Check enemy defeat
        if (battle.enemy_hp <= 0) {
            result.won = true;
            result.messages.push(`\\n🎉 *VICTORY!* You defeated ${enemy.name}!`);
            
            const rewards = await this.grantRewards(player, enemy);
            result.rewards = rewards;
            
            await this.endBattle(phone, 'won', battle);
            return result;
        }

        // Enemy counter-attack
        if (!result.fled) {
            const isDefending = action === 'defend';
            result.damageTaken = this.calculateEnemyDamage(enemy, isDefending);
            battle.player_hp -= result.damageTaken;
            
            if (result.damageTaken > 0) {
                result.messages.push(`👹 ${enemy.name} attacks for *${result.damageTaken}* damage!`);
            } else {
                result.messages.push(`🛡️ You blocked the attack completely!`);
            }
        }

        // Check player defeat
        if (battle.player_hp <= 0) {
            result.lost = true;
            result.messages.push(`\\n💀 *DEFEAT!* You were knocked out!`);
            await this.endBattle(phone, 'lost', battle);
            return result;
        }

        // Update battle state
        battle.turn++;
        await this.updateBattle(phone, battle);

        // Format result message
        result.messages.push(`\\n📊 *Battle Status - Turn ${battle.turn}*`);
        result.messages.push(`${this.formatHealthBar(battle.player_hp, battle.player_max_hp, '❤️ You')}`);
        result.messages.push(`${this.formatHealthBar(battle.enemy_hp, battle.enemy_max_hp, `👹 ${enemy.name}`)}`);
        result.messages.push(`\\n🎮 Next action: /attack, /defend, /heal, /flee, /special`);

        return result;
    }

    calculatePlayerDamage(player, isSpecial = false) {
        let baseDamage = player.power || 10;
        
        // Add equipped pet damage
        this.db.getEquippedPet(player.phone).then(pet => {
            if (pet) baseDamage += pet.atk;
        });

        // Variance
        const variance = 0.8 + (Math.random() * 0.4);
        let damage = Math.floor(baseDamage * variance);

        if (isSpecial) damage = Math.floor(damage * 1.5);

        return Math.max(1, damage);
    }

    calculateEnemyDamage(enemy, isDefending = false) {
        const [min, max] = enemy.damage.split('-').map(Number);
        let damage = Math.floor(Math.random() * (max - min + 1)) + min;
        if (isDefending) damage = Math.floor(damage * 0.3);
        return damage;
    }

    formatHealthBar(current, max, label) {
        const percentage = Math.floor((current / max) * 10);
        const filled = '█'.repeat(percentage);
        const empty = '░'.repeat(10 - percentage);
        return `${label}: [${filled}${empty}] ${current}/${max}`;
    }

    async grantRewards(player, enemy) {
        const baseReward = Math.floor(Math.random() * (enemy.max_reward - enemy.min_reward + 1)) + enemy.min_reward;
        const levelBonus = Math.floor(baseReward * (player.level * 0.05));
        const totalPoints = baseReward + levelBonus;
        const expGain = enemy.exp || 10;

        // Update player
        await this.db.updatePlayer(player.phone, {
            points: player.points + totalPoints,
            exp: player.exp + expGain,
            wins: player.wins + 1
        });

        // Check level up
        let leveledUp = false;
        const expNeeded = player.level * 100;
        if (player.exp + expGain >= expNeeded) {
            await this.db.updatePlayer(player.phone, {
                level: player.level + 1,
                power: player.power + 5,
                max_hp: player.max_hp + 20,
                hp: player.max_hp + 20,
                exp: 0
            });
            leveledUp = true;
        }

        return {
            points: totalPoints,
            exp: expGain,
            leveledUp: leveledUp,
            newLevel: leveledUp ? player.level + 1 : null
        };
    }

    async updateBattle(phone, battle) {
        await this.db.updateBattle(phone, {
            player_hp: battle.player_hp,
            enemy_hp: battle.enemy_hp,
            turn: battle.turn,
            last_action: battle.last_action
        });
    }

    async endBattle(phone, outcome, battle) {
        if (outcome === 'lost') {
            const player = await this.db.getPlayer(phone);
            await this.db.updatePlayer(phone, {
                losses: player.losses + 1,
                hp: Math.max(1, Math.floor(player.max_hp * 0.1)) // 10% HP after defeat
            });
        }

        await this.db.deleteActiveBattle(phone);
    }

    async healPlayer(phone) {
        const player = await this.db.getPlayer(phone);
        if (player.hp >= player.max_hp) {
            return { error: 'You are already at full health!' };
        }

        const healAmount = Math.floor(player.max_hp * 0.5);
        const newHp = Math.min(player.max_hp, player.hp + healAmount);
        
        await this.db.updatePlayer(phone, { hp: newHp });

        return {
            success: true,
            healed: newHp - player.hp,
            currentHp: newHp,
            maxHp: player.max_hp
        };
    }
}

module.exports = PvESystem;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/systems/pveSystem.js', 'w') as f:
    f.write(pve_system)

print("✅ 8. src/systems/pveSystem.js created")