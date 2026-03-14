const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class PveSystem {
    static async startBattle(sock, phone, jid, difficulty = null) {
        const db = Database.get();
        const player = GameEngine.getPlayer(phone);
        
        // Check existing battle
        const existing = db.prepare(`
            SELECT * FROM active_battles 
            WHERE phone = ? AND status = 'active'
        `).get(phone);
        
        if (existing) {
            return sock.sendMessage(jid, { 
                text: '⚠️ You already have an active battle!\nUse /status to see it or /attack to continue.' 
            });
        }
        
        // Check HP
        if (player.hp <= 0) {
            return sock.sendMessage(jid, { 
                text: '❌ You are knocked out! Heal first using items or wait for regeneration.' 
            });
        }
        
        // Get enemy
        const enemy = Helpers.getRandomEnemy(player.level);
        
        // Scale enemy based on difficulty
        let multiplier = 1;
        if (difficulty === 'hard') multiplier = 1.5;
        if (difficulty === 'extreme') multiplier = 2;
        
        const scaledEnemy = {
            ...enemy,
            hp: Math.floor(enemy.hp * multiplier),
            maxHp: Math.floor(enemy.hp * multiplier),
            attack: Math.floor(enemy.attack * multiplier),
            defense: Math.floor(enemy.defense * multiplier),
            exp: Math.floor(enemy.exp * multiplier),
            points: Math.floor(enemy.points * multiplier)
        };
        
        // Create battle
        db.prepare(`
            INSERT INTO active_battles (
                phone, enemy_name, enemy_level, enemy_hp, enemy_max_hp,
                enemy_attack, enemy_defense, player_hp, player_max_hp, battle_type, rewards
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            phone,
            scaledEnemy.name,
            player.level,
            scaledEnemy.hp,
            scaledEnemy.maxHp,
            scaledEnemy.attack,
            scaledEnemy.defense,
            player.hp,
            player.max_hp,
            difficulty || 'normal',
            JSON.stringify({ exp: scaledEnemy.exp, points: scaledEnemy.points })
        );
        
        // Send battle start message
        const text = `⚔️ *BATTLE STARTED!*\n\n` +
            `👤 You (Lv.${player.level}) vs 👹 ${scaledEnemy.name}\n` +
            `${difficulty ? `Difficulty: ${Helpers.capitalize(difficulty)}\n` : ''}\n` +
            `❤️ Your HP: ${Helpers.hpBar(player.hp, player.max_hp)} ${player.hp}/${player.max_hp}\n` +
            `💀 Enemy HP: ${Helpers.hpBar(scaledEnemy.hp, scaledEnemy.maxHp)} ${scaledEnemy.hp}/${scaledEnemy.maxHp}\n\n` +
            `⚔️ Enemy ATK: ${scaledEnemy.attack} | 🛡️ DEF: ${scaledEnemy.defense}\n\n` +
            `*Commands:*\n` +
            `/attack - Strike with weapon\n` +
            `/defend - Block 70% damage\n` +
            `/heal - Use healing (30% HP)\n` +
            `/special - Pet special attack\n` +
            `/flee - Try to escape\n` +
            `/status - Check battle status`;
            
        await sock.sendMessage(jid, { text });
    }
    
    static async attack(sock, phone, jid, special = false) {
        const db = Database.get();
        const battle = db.prepare(`
            SELECT * FROM active_battles 
            WHERE phone = ? AND status = 'active'
        `).get(phone);
        
        if (!battle) {
            return sock.sendMessage(jid, { text: '❌ No active battle. Start with /battle' });
        }
        
        const player = GameEngine.getPlayer(phone);
        const equipped = GameEngine.getEquippedPet(phone);
        const config = global.gameConfig;
        
        // Get active effects
        const effects = JSON.parse(player.active_effects || '{}');
        let attackBoost = effects.attack?.value || 0;
        let critBoost = effects.critChance || 0;
        
        // Calculate player damage
        let playerAttack = player.attack + attackBoost;
        if (equipped) playerAttack += equipped.attack_bonus;
        
        if (special) {
            playerAttack *= config.combat.specialMultiplier;
        }
        
        const isCrit = Helpers.isCrit(config.combat.critChance + critBoost);
        const damage = Helpers.calculateDamage(
            { attack: playerAttack },
            { defense: battle.enemy_defense },
            isCrit
        );
        
        const newEnemyHp = Math.max(0, battle.enemy_hp - damage);
        
        // Enemy counter-attack if still alive
        let newPlayerHp = battle.player_hp;
        let enemyDamage = 0;
        let enemyCrit = false;
        
        if (newEnemyHp > 0) {
            const playerDefense = player.defense + (equipped?.defense_bonus || 0) + (effects.defense?.value || 0);
            enemyCrit = Helpers.isCrit();
            enemyDamage = Helpers.calculateDamage(
                { attack: battle.enemy_attack },
                { defense: playerDefense },
                enemyCrit
            );
            newPlayerHp = Math.max(0, battle.player_hp - enemyDamage);
        }
        
        // Update battle
        db.prepare(`
            UPDATE active_battles 
            SET enemy_hp = ?, player_hp = ?, turn = turn + 1, last_action = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(newEnemyHp, newPlayerHp, battle.id);
        
        // Build response
        let text = `⚔️ *Turn ${battle.turn}*\n\n`;
        
        // Player action
        if (special) {
            text += `✨ *${equipped?.name || 'Your pet'} used SPECIAL ATTACK!*\n`;
        }
        text += `👤 You ${isCrit ? '💥 CRIT' : 'hit'} for *${damage}* damage!\n`;
        
        if (newEnemyHp <= 0) {
            // Victory!
            await this.handleVictory(sock, phone, jid, battle, player);
            return;
        }
        
        // Enemy action
        text += `💀 ${battle.enemy_name} ${enemyCrit ? '💥 CRIT' : 'hits'} for *${enemyDamage}* damage!\n\n`;
        
        // HP bars
        text += `❤️ You: ${Helpers.hpBar(newPlayerHp, battle.player_max_hp)} ${newPlayerHp}/${battle.player_max_hp}\n`;
        text += `💀 Enemy: ${Helpers.hpBar(newEnemyHp, battle.enemy_max_hp)} ${newEnemyHp}/${battle.enemy_max_hp}\n\n`;
        
        // Check player death
        if (newPlayerHp <= 0) {
            await this.handleDefeat(sock, phone, jid, battle);
            return;
        }
        
        // Decrement effect durations
        if (effects.attack && effects.attack.duration) {
            effects.attack.duration--;
            if (effects.attack.duration <= 0) delete effects.attack;
        }
        if (effects.critDuration) {
            effects.critDuration--;
            if (effects.critDuration <= 0) delete effects.critChance;
        }
        
        if (Object.keys(effects).length > 0) {
            GameEngine.updatePlayer(phone, { active_effects: JSON.stringify(effects) });
        }
        
        text += `_Turn ${battle.turn + 1}_ - /attack /defend /heal /special /flee`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async defend(sock, phone, jid) {
        const db = Database.get();
        const battle = db.prepare(`
            SELECT * FROM active_battles 
            WHERE phone = ? AND status = 'active'
        `).get(phone);
        
        if (!battle) {
            return sock.sendMessage(jid, { text: '❌ No active battle.' });
        }
        
        const player = GameEngine.getPlayer(phone);
        const equipped = GameEngine.getEquippedPet(phone);
        const config = global.gameConfig;
        
        // Enemy attacks with 70% reduction
        const effects = JSON.parse(player.active_effects || '{}');
        const playerDefense = (player.defense + (equipped?.defense_bonus || 0) + (effects.defense?.value || 0)) * 2;
        
        const enemyCrit = Helpers.isCrit();
        const rawDamage = Helpers.calculateDamage(
            { attack: battle.enemy_attack },
            { defense: playerDefense },
            enemyCrit
        );
        const damage = Math.floor(rawDamage * (1 - config.combat.defendReduction));
        
        const newPlayerHp = Math.max(0, battle.player_hp - damage);
        
        db.prepare(`
            UPDATE active_battles 
            SET player_hp = ?, turn = turn + 1, last_action = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(newPlayerHp, battle.id);
        
        let text = `🛡️ *Defensive Stance*\n\n`;
        text += `You blocked most of the damage!\n`;
        text += `💀 ${battle.enemy_name} ${enemyCrit ? '💥 CRIT ' : ''}hit for only *${damage}*!\n\n`;
        text += `❤️ You: ${Helpers.hpBar(newPlayerHp, battle.player_max_hp)} ${newPlayerHp}/${battle.player_max_hp}\n`;
        text += `💀 Enemy: ${Helpers.hpBar(battle.enemy_hp, battle.enemy_max_hp)} ${battle.enemy_hp}/${battle.enemy_max_hp}\n\n`;
        
        if (newPlayerHp <= 0) {
            await this.handleDefeat(sock, phone, jid, battle);
            return;
        }
        
        text += `_Turn ${battle.turn + 1}_`;
        await sock.sendMessage(jid, { text });
    }
    
    static async heal(sock, phone, jid) {
        const db = Database.get();
        const battle = db.prepare(`
            SELECT * FROM active_battles 
            WHERE phone = ? AND status = 'active'
        `).get(phone);
        
        if (!battle) {
            return sock.sendMessage(jid, { text: '❌ No active battle.' });
        }
        
        const player = GameEngine.getPlayer(phone);
        const config = global.gameConfig;
        const equipped = GameEngine.getEquippedPet(phone);
        
        // Heal amount
        const healAmount = Math.floor(battle.player_max_hp * config.combat.healPercentage);
        const newHp = Math.min(battle.player_max_hp, battle.player_hp + healAmount);
        
        // Enemy gets free hit
        const effects = JSON.parse(player.active_effects || '{}');
        const playerDefense = player.defense + (equipped?.defense_bonus || 0) + (effects.defense?.value || 0);
        
        const enemyCrit = Helpers.isCrit();
        const enemyDamage = Helpers.calculateDamage(
            { attack: battle.enemy_attack },
            { defense: playerDefense },
            enemyCrit
        );
        
        const finalHp = Math.max(0, newHp - enemyDamage);
        
        db.prepare(`
            UPDATE active_battles 
            SET player_hp = ?, turn = turn + 1, last_action = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(finalHp, battle.id);
        
        let text = `💚 *Heal*\n\n`;
        text += `+${healAmount} HP restored!\n`;
        text += `💀 ${battle.enemy_name} ${enemyCrit ? '💥 CRIT ' : ''}hit for *${enemyDamage}*!\n\n`;
        text += `❤️ You: ${Helpers.hpBar(finalHp, battle.player_max_hp)} ${finalHp}/${battle.player_max_hp}\n`;
        text += `💀 Enemy: ${Helpers.hpBar(battle.enemy_hp, battle.enemy_max_hp)} ${battle.enemy_hp}/${battle.enemy_max_hp}\n\n`;
        
        if (finalHp <= 0) {
            await this.handleDefeat(sock, phone, jid, battle);
            return;
        }
        
        text += `_Turn ${battle.turn + 1}_`;
        await sock.sendMessage(jid, { text });
    }
    
    static async special(sock, phone, jid) {
        const equipped = GameEngine.getEquippedPet(phone);
        if (!equipped) {
            return sock.sendMessage(jid, { 
                text: '❌ No pet equipped! Use /pets to see your pets and /equip [number] to equip one.' 
            });
        }
        
        await this.attack(sock, phone, jid, true);
    }
    
    static async flee(sock, phone, jid) {
        const db = Database.get();
        const battle = db.prepare(`
            SELECT * FROM active_battles 
            WHERE phone = ? AND status = 'active'
        `).get(phone);
        
        if (!battle) {
            return sock.sendMessage(jid, { text: '❌ No active battle.' });
        }
        
        const player = GameEngine.getPlayer(phone);
        
        if (Helpers.canFlee(player.speed, 5)) {
            db.prepare("UPDATE active_battles SET status = 'fled' WHERE id = ?").run(battle.id);
            await sock.sendMessage(jid, { 
                text: `🏃 *Escaped!*\n\nYou got away safely.\nNo rewards gained.` 
            });
        } else {
            // Failed flee - enemy gets free hit with bonus
            const equipped = GameEngine.getEquippedPet(phone);
            const effects = JSON.parse(player.active_effects || '{}');
            const playerDefense = player.defense + (equipped?.defense_bonus || 0) + (effects.defense?.value || 0);
            
            const enemyCrit = Helpers.isCrit();
            const damage = Math.floor(Helpers.calculateDamage(
                { attack: battle.enemy_attack },
                { defense: playerDefense },
                enemyCrit
            ) * 1.5);
            
            const newHp = Math.max(0, battle.player_hp - damage);
            
            db.prepare(`
                UPDATE active_battles 
                SET player_hp = ?, turn = turn + 1, last_action = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(newHp, battle.id);
            
            let text = `🏃 *Failed to escape!*\n\n`;
            text += `You tripped! ${battle.enemy_name} ${enemyCrit ? '💥 CRIT ' : ''}hit for *${damage}*!\n\n`;
            text += `❤️ You: ${Helpers.hpBar(newHp, battle.player_max_hp)} ${newHp}/${battle.player_max_hp}\n`;
            
            if (newHp <= 0) {
                await this.handleDefeat(sock, phone, jid, battle);
                return;
            }
            
            await sock.sendMessage(jid, { text });
        }
    }
    
    static async status(sock, phone, jid) {
        const db = Database.get();
        const battle = db.prepare(`
            SELECT * FROM active_battles 
            WHERE phone = ? AND status = 'active'
        `).get(phone);
        
        if (!battle) {
            return sock.sendMessage(jid, { text: '❌ No active battle. Start with /battle' });
        }
        
        const player = GameEngine.getPlayer(phone);
        
        let text = `⚔️ *Battle Status - Turn ${battle.turn}*\n\n`;
        text += `👤 You vs 👹 ${battle.enemy_name}\n\n`;
        text += `❤️ Your HP: ${Helpers.hpBar(battle.player_hp, battle.player_max_hp)} ${battle.player_hp}/${battle.player_max_hp}\n`;
        text += `💀 Enemy HP: ${Helpers.hpBar(battle.enemy_hp, battle.enemy_max_hp)} ${battle.enemy_hp}/${battle.enemy_max_hp}\n\n`;
        text += `Commands: /attack /defend /heal /special /flee`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleVictory(sock, phone, jid, battle, player) {
        const db = Database.get();
        const rewards = JSON.parse(battle.rewards);
        
        // Calculate rewards with boosts
        const effects = JSON.parse(player.active_effects || '{}');
        const xpMultiplier = effects.xpMultiplier || 1;
        
        const finalExp = Math.floor(rewards.exp * xpMultiplier);
        const finalPoints = rewards.points;
        
        // Update battle status
        db.prepare("UPDATE active_battles SET status = 'won' WHERE id = ?").run(battle.id);
        
        // Give rewards
        const levelResult = GameEngine.addExp(phone, finalExp);
        GameEngine.addPoints(phone, finalPoints);
        
        // Restore HP
        GameEngine.updatePlayer(phone, { hp: player.max_hp });
        
        // Decrement XP boost
        if (effects.xpDuration) {
            effects.xpDuration--;
            if (effects.xpDuration <= 0) delete effects.xpMultiplier;
            GameEngine.updatePlayer(phone, { active_effects: JSON.stringify(effects) });
        }
        
        // Build victory message
        let text = `🎉 *VICTORY!* 🎉\n\n`;
        text += `You defeated ${battle.enemy_name}!\n\n`;
        text += `⭐ +${Helpers.formatNumber(finalExp)} XP`;
        if (xpMultiplier > 1) text += ` (Boosted!)`;
        text += `\n`;
        text += `💰 +${Helpers.formatNumber(finalPoints)} points\n`;
        
        if (levelResult.leveledUp) {
            text += `\n🆙 *LEVEL UP!* ${levelResult.newLevel - 1} → ${levelResult.newLevel}\n`;
            text += `❤️ Full HP restored!\n`;
        }
        
        // Random drop chance (20%)
        if (Math.random() < 0.2) {
            const items = ['Health Potion', 'Attack Boost', 'Defense Boost'];
            const drop = items[Math.floor(Math.random() * items.length)];
            GameEngine.addItem(phone, 'consumable', drop);
            text += `\n🎁 Bonus drop: ${drop}!`;
        }
        
        text += `\n\nNext battle: /battle`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleDefeat(sock, phone, jid, battle) {
        const db = Database.get();
        db.prepare("UPDATE active_battles SET status = 'lost' WHERE id = ?").run(battle.id);
        
        // Player keeps 1 HP
        GameEngine.updatePlayer(phone, { hp: 1 });
        
        const text = `💀 *DEFEAT*\n\n` +
            `You were knocked out by ${battle.enemy_name}!\n` +
            `You barely escaped with 1 HP.\n\n` +
            `Rest and try again with /battle`;
            
        await sock.sendMessage(jid, { text });
    }
}

module.exports = PveSystem;
