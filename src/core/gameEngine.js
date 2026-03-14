const Database = require('./database');
const Helpers = require('../utils/helpers');
const moment = require('moment');

class GameEngine {
    // ==================== PLAYER MANAGEMENT ====================
    
    static getPlayer(phone) {
        const db = Database.get();
        return db.prepare('SELECT * FROM players WHERE phone = ?').get(phone);
    }

    static createPlayer(phone, name = 'Player') {
        const db = Database.get();
        const existing = this.getPlayer(phone);
        if (existing) return existing;

        const config = global.gameConfig;
        
        db.prepare(`
            INSERT INTO players (
                phone, name, hp, max_hp, attack, defense, speed, 
                last_daily, last_steal, last_pvp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            phone, 
            name.substring(0, 20), 
            100, 
            100, 
            10, 
            5, 
            5,
            new Date(0).toISOString(),
            new Date(0).toISOString(),
            new Date(0).toISOString()
        );

        this.logAction('player_created', phone, { name });
        return this.getPlayer(phone);
    }

    static updatePlayer(phone, updates) {
        const db = Database.get();
        const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);
        
        db.prepare(`
            UPDATE players 
            SET ${sets}, last_active = CURRENT_TIMESTAMP 
            WHERE phone = ?
        `).run(...values, phone);
    }

    static deletePlayer(phone) {
        const db = Database.get();
        db.prepare('DELETE FROM players WHERE phone = ?').run(phone);
        this.logAction('player_deleted', phone, {});
    }

    static updateActivity(phone) {
        const db = Database.get();
        db.prepare('UPDATE players SET last_active = CURRENT_TIMESTAMP WHERE phone = ?').run(phone);
    }

    // ==================== PET SYSTEM ====================

    static givePet(phone, crateType = 'Common') {
        const config = global.gameConfig;
        const db = Database.get();
        
        // Check max pets
        const petCount = db.prepare('SELECT COUNT(*) as count FROM pets WHERE owner_phone = ?').get(phone).count;
        if (petCount >= config.pets.maxPets) {
            return { error: 'Max pets reached' };
        }

        const pet = this.generatePet(crateType);
        
        const result = db.prepare(`
            INSERT INTO pets (
                owner_phone, name, rarity, type, 
                hp_bonus, attack_bonus, defense_bonus, speed_bonus
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            phone, 
            pet.name, 
            pet.rarity, 
            pet.type,
            pet.hp_bonus, 
            pet.attack_bonus, 
            pet.defense_bonus, 
            pet.speed_bonus
        );

        this.logAction('pet_obtained', phone, { pet: pet.name, rarity: pet.rarity });
        return { id: result.lastInsertRowid, ...pet };
    }

    static generatePet(crateType) {
        const config = global.gameConfig;
        const rarities = config.pets.rarities;
        const types = config.pets.types;
        const crate = config.crates[crateType];
        
        // Roll rarity with boost
        let roll = Math.random();
        let cumulative = 0;
        let selectedRarity = 'Common';
        
        for (const [rarity, data] of Object.entries(rarities)) {
            cumulative += data.chance + (crate?.rarityBoost || 0);
            if (roll <= cumulative) {
                selectedRarity = rarity;
                break;
            }
        }
        
        // Select random type
        const type = types[Math.floor(Math.random() * types.length)];
        const rarityData = rarities[selectedRarity];
        
        return {
            name: `${rarityData.color} ${type.type}`,
            rarity: selectedRarity,
            type: type.type,
            hp_bonus: Math.floor(type.hp * rarityData.multiplier),
            attack_bonus: Math.floor(type.attack * rarityData.multiplier),
            defense_bonus: Math.floor(type.defense * rarityData.multiplier),
            speed_bonus: Math.floor(type.speed * rarityData.multiplier)
        };
    }

    static getPlayerPets(phone) {
        const db = Database.get();
        return db.prepare(`
            SELECT * FROM pets 
            WHERE owner_phone = ? 
            ORDER BY equipped DESC, rarity DESC, level DESC, id DESC
        `).all(phone);
    }

    static getPetById(petId) {
        const db = Database.get();
        return db.prepare('SELECT * FROM pets WHERE id = ?').get(petId);
    }

    static getEquippedPet(phone) {
        const db = Database.get();
        return db.prepare('SELECT * FROM pets WHERE owner_phone = ? AND equipped = 1').get(phone);
    }

    static equipPet(phone, petId) {
        const db = Database.get();
        const config = global.gameConfig;
        
        // Unequip current
        db.prepare('UPDATE pets SET equipped = 0 WHERE owner_phone = ?').run(phone);
        
        // Equip new
        db.prepare('UPDATE pets SET equipped = 1 WHERE id = ? AND owner_phone = ?').run(petId, phone);
        
        // Recalculate player stats
        const player = this.getPlayer(phone);
        const pet = db.prepare('SELECT * FROM pets WHERE id = ?').get(petId);
        
        if (pet) {
            const baseHp = 100 + ((player.level - 1) * config.leveling.hpPerLevel);
            const baseAtk = 10 + ((player.level - 1) * config.leveling.attackPerLevel);
            const baseDef = 5 + ((player.level - 1) * config.leveling.defensePerLevel);
            const baseSpd = 5 + ((player.level - 1) * config.leveling.speedPerLevel);
            
            this.updatePlayer(phone, {
                max_hp: baseHp + pet.hp_bonus,
                attack: baseAtk + pet.attack_bonus,
                defense: baseDef + pet.defense_bonus,
                speed: baseSpd + pet.speed_bonus,
                equipped_pet: petId
            });
        }
        
        return pet;
    }

    static unequipPet(phone) {
        const db = Database.get();
        const config = global.gameConfig;
        
        db.prepare('UPDATE pets SET equipped = 0 WHERE owner_phone = ?').run(phone);
        
        const player = this.getPlayer(phone);
        const baseHp = 100 + ((player.level - 1) * config.leveling.hpPerLevel);
        const baseAtk = 10 + ((player.level - 1) * config.leveling.attackPerLevel);
        const baseDef = 5 + ((player.level - 1) * config.leveling.defensePerLevel);
        const baseSpd = 5 + ((player.level - 1) * config.leveling.speedPerLevel);
        
        this.updatePlayer(phone, {
            max_hp: baseHp,
            attack: baseAtk,
            defense: baseDef,
            speed: baseSpd,
            equipped_pet: null
        });
    }

    static releasePet(phone, petId) {
        const db = Database.get();
        const pet = db.prepare('SELECT * FROM pets WHERE id = ? AND owner_phone = ?').get(petId, phone);
        
        if (!pet) return false;
        
        if (pet.equipped) {
            this.unequipPet(phone);
        }
        
        db.prepare('DELETE FROM pets WHERE id = ?').run(petId);
        this.logAction('pet_released', phone, { pet: pet.name });
        return true;
    }

    // ==================== LEVELING SYSTEM ====================

    static addExp(phone, exp) {
        const config = global.gameConfig;
        const player = this.getPlayer(phone);
        let newExp = player.exp + exp;
        let newLevel = player.level;
        let leveledUp = false;
        
        // Check for level ups
        while (newLevel < config.leveling.maxLevel) {
            const required = Helpers.getRequiredExp(newLevel + 1);
            if (newExp >= required) {
                newExp -= required;
                newLevel++;
                leveledUp = true;
            } else {
                break;
            }
        }
        
        const updates = { exp: newExp };
        
        if (leveledUp) {
            updates.level = newLevel;
            updates.max_hp = 100 + ((newLevel - 1) * config.leveling.hpPerLevel);
            updates.attack = 10 + ((newLevel - 1) * config.leveling.attackPerLevel);
            updates.defense = 5 + ((newLevel - 1) * config.leveling.defensePerLevel);
            updates.speed = 5 + ((newLevel - 1) * config.leveling.speedPerLevel);
            updates.hp = updates.max_hp; // Full heal on level up
            
            this.logAction('level_up', phone, { oldLevel: player.level, newLevel });
        }
        
        this.updatePlayer(phone, updates);
        return { leveledUp, newLevel, newExp };
    }

    // ==================== ECONOMY ====================

    static addPoints(phone, points) {
        const db = Database.get();
        const player = this this.getPlayer.getPlayer(phone);
        
        if (points > 0) {
            db.prepare('UPDATE players SET points = points + ?, total_earned = total_earned + ? WHERE phone = ?')
                .run(points, points, phone);
        } else {
            db.prepare('UPDATE players SET points = points + ?, total_spent = total_spent + ? WHERE phone = ?')
                .run(points, Math.abs(points), phone);
        }
        
        return this.getPlayer(phone);
    }

    static transferPoints(from, to, amount) {
        const db = Database.get();
        
        const sender = this.getPlayer(from);
        if (sender.points < amount) return false;
        
        db.prepare('UPDATE players SET points = points - ? WHERE phone = ?').run(amount, from);
        db.prepare('UPDATE players SET points = points + ? WHERE phone = ?').run(amount, to);
        
        this.logAction('transfer', from, { to, amount });
        return true;
    }

    // ==================== INVENTORY ====================

    static getInventory(phone) {
        const db = Database.get();
        return db.prepare('SELECT * FROM inventory WHERE phone = ? ORDER BY item_type, item_name').all(phone);
    }

    static getItem(phone, itemName) {
        const db = Database.get();
        return db.prepare('SELECT * FROM inventory WHERE phone = ? AND item_name = ?').get(phone, itemName);
    }

    static addItem(phone, itemType, itemName, quantity = 1, stats = null) {
        const db = Database.get();
        const existing = db.prepare('SELECT * FROM inventory WHERE phone = ? AND item_name = ?').get(phone, itemName);
        
        if (existing) {
            db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE id = ?')
                .run(quantity, existing.id);
        } else {
            db.prepare(`
                INSERT INTO inventory (phone, item_type, item_name, quantity, stats) 
                VALUES (?, ?, ?, ?, ?)
            `).run(phone, itemType, itemName, quantity, stats ? JSON.stringify(stats) : null);
        }
        
        this.logAction('item_obtained', phone, { item: itemName, quantity });
    }

    static removeItem(phone, itemName, quantity = 1) {
        const db = Database.get();
        const existing = db.prepare('SELECT * FROM inventory WHERE phone = ? AND item_name = ?').get(phone, itemName);
        
        if (!existing || existing.quantity < quantity) return false;
        
        if (existing.quantity === quantity) {
            db.prepare('DELETE FROM inventory WHERE id = ?').run(existing.id);
        } else {
            db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?')
                .run(quantity, existing.id);
        }
        
        return true;
    }

    static useItem(phone, itemName) {
        const config = global.gameConfig;
        const item = config.shopItems.find(i => i.name === itemName);
        if (!item) return { success: false, message: 'Item not found' };
        
        if (!this.removeItem(phone, itemName, 1)) {
            return { success: false, message: 'You don\'t have this item' };
        }
        
        const player = this.getPlayer(phone);
        let message = '';
        
        switch(item.effect) {
            case 'heal':
                const healAmount = item.value === 9999 ? player.max_hp : item.value;
                const newHp = Math.min(player.max_hp, player.hp + healAmount);
                this.updatePlayer(phone, { hp: newHp });
                message = `❤️ Restored ${healAmount} HP!`;
                break;
                
            case 'shield':
                const hours = item.value;
                const expires = moment().add(hours, 'hours').toISOString();
                this.updatePlayer(phone, { 
                    shield_active: 1, 
                    shield_expires: expires 
                });
                message = `🛡️ Shield activated for ${hours} hours!`;
                break;
                
            case 'boost':
                // Store boost in active_effects
                const effects = JSON.parse(player.active_effects || '{}');
                effects[item.stat] = {
                    value: item.value,
                    duration: item.duration || 1
                };
                this.updatePlayer(phone, { active_effects: JSON.stringify(effects) });
                message = `⚡ ${item.stat} boosted by ${item.value} for ${item.duration} battle(s)!`;
                break;
                
            case 'luck':
                const luckEffects = JSON.parse(player.active_effects || '{}');
                luckEffects.critChance = item.value;
                luckEffects.critDuration = item.duration || 5;
                this.updatePlayer(phone, { active_effects: JSON.stringify(luckEffects) });
                message = `🍀 Luck increased(phone);
        
        if (points > 0) {
            db.prepare('UPDATE players SET points = points + ?, total_earned = total_earned + ? WHERE phone = ?')
                .run(points, points, phone);
        } else {
            db.prepare('UPDATE players SET points = points + ?, total_spent = total_spent + ? WHERE phone = ?')
                .run(points, Math.abs(points), phone);
        }
        
        return this.getPlayer(phone);
    }

    static transferPoints(from, to, amount) {
        const db = Database.get();
        
        const sender = this.getPlayer(from);
        if (sender.points < amount) return false;
        
        db.prepare('UPDATE players SET points = points - ? WHERE phone = ?').run(amount, from);
        db.prepare('UPDATE players SET points = points + ? WHERE phone = ?').run(amount, to);
        
        this.logAction('transfer', from, { to, amount });
        return true;
    }

    // ==================== INVENTORY ====================

    static getInventory(phone) {
        const db = Database.get();
        return db.prepare('SELECT * FROM inventory WHERE phone = ? ORDER BY item_type, item_name').all(phone);
    }

    static getItem(phone, itemName) {
        const db = Database.get();
        return db.prepare('SELECT * FROM inventory WHERE phone = ? AND item_name = ?').get(phone, itemName);
    }

    static addItem(phone, itemType, itemName, quantity = 1, stats = null) {
        const db = Database.get();
        const existing = db.prepare('SELECT * FROM inventory WHERE phone = ? AND item_name = ?').get(phone, itemName);
        
        if (existing) {
            db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE id = ?')
                .run(quantity, existing.id);
        } else {
            db.prepare(`
                INSERT INTO inventory (phone, item_type, item_name, quantity, stats) 
                VALUES (?, ?, ?, ?, ?)
            `).run(phone, itemType, itemName, quantity, stats ? JSON.stringify(stats) : null);
        }
        
        this.logAction('item_obtained', phone, { item: itemName, quantity });
    }

    static removeItem(phone, itemName, quantity = 1) {
        const db = Database.get();
        const existing = db.prepare('SELECT * FROM inventory WHERE phone = ? AND item_name = ?').get(phone, itemName);
        
        if (!existing || existing.quantity < quantity) return false;
        
        if (existing.quantity === quantity) {
            db.prepare('DELETE FROM inventory WHERE id = ?').run(existing.id);
        } else {
            db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?')
                .run(quantity, existing.id);
        }
        
        return true;
    }

    static useItem(phone, itemName) {
        const config = global.gameConfig;
        const item = config.shopItems.find(i => i.name === itemName);
        if (!item) return { success: false, message: 'Item not found' };
        
        if (!this.removeItem(phone, itemName, 1)) {
            return { success: false, message: 'You don\'t have this item' };
        }
        
        const player = this.getPlayer(phone);
        let message = '';
        
        switch(item.effect) {
            case 'heal':
                const healAmount = item.value === 9999 ? player.max_hp : item.value;
                const newHp = Math.min(player.max_hp, player.hp + healAmount);
                this.updatePlayer(phone, { hp: newHp });
                message = `❤️ Restored ${healAmount} HP!`;
                break;
                
            case 'shield':
                const hours = item.value;
                const expires = moment().add(hours, 'hours').toISOString();
                this.updatePlayer(phone, { 
                    shield_active: 1, 
                    shield_expires: expires 
                });
                message = `🛡️ Shield activated for ${hours} hours!`;
                break;
                
            case 'boost':
                // Store boost in active_effects
                const effects = JSON.parse(player.active_effects || '{}');
                effects[item.stat] = {
                    value: item.value,
                    duration: item.duration || 1
                };
                this.updatePlayer(phone, { active_effects: JSON.stringify(effects) });
                message = `⚡ ${item.stat} boosted by ${item.value} for ${item.duration} battle(s)!`;
                break;
                
            case 'luck':
                const luckEffects = JSON.parse(player.active_effects || '{}');
                luckEffects.critChance = item.value;
                luckEffects.critDuration = item.duration || 5;
                this.updatePlayer(phone, { active_effects: JSON.stringify(luckEffects) });
                message = `🍀 Luck increased for ${item.duration} battles!`;
                break;
                
            case 'xp':
                const xpEffects = JSON.parse(player.active_effects || '{}');
                xpEffects.xpMultiplier = item.value;
                xpEffects.xpDuration = item.duration || 10;
                this.updatePlayer(phone, { active_effects: JSON.stringify(xpEffects) });
                message = `📈 XP boost activated for ${item.duration} battles!`;
                break;
        }
        
        this.logAction('item_used', phone, { item: itemName });
        return { success: true, message };
    }

    // ==================== LEADERBOARD ====================

    static getLeaderboard(type = 'elo', limit = 10) {
        const db = Database.get();
        let query;
        
        switch(type) {
            case 'level':
                query = `SELECT phone, name, level, exp, wins, losses, elo, rank 
                        FROM players WHERE banned = 0 
                        ORDER BY level DESC, exp DESC LIMIT ?`;
                break;
            case 'points':
                query = `SELECT phone, name, points, bank_points, (points + bank_points) as total,
                        wins, losses, elo, rank 
                        FROM players WHERE banned = 0 
                        ORDER BY total DESC LIMIT ?`;
                break;
            case 'pvp':
                query = `SELECT phone, name, wins, losses, 
                        CASE WHEN (wins + losses) > 0 THEN ROUND(wins * 100.0 / (wins + losses), 1) ELSE 0 END as winrate,
                        elo, rank 
                        FROM players WHERE banned = 0 AND (wins + losses) > 0
                        ORDER BY wins DESC, winrate DESC LIMIT ?`;
                break;
            case 'elo':
            default:
                query = `SELECT phone, name, level, exp, points, wins, losses, elo, rank 
                        FROM players WHERE banned = 0 
                        ORDER BY elo DESC, level DESC, exp DESC LIMIT ?`;
        }
        
        return db.prepare(query).all(limit);
    }

    // ==================== MESSAGES (INBOX) ====================

    static sendMessage(to, from, fromName, title, content, type = 'player') {
        const db = Database.get();
        
        db.prepare(`
            INSERT INTO messages (phone, sender, sender_name, title, content, type)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(to, from, fromName, title, content, type);
        
        // Notify receiver if they have notifications enabled
        const receiver = this.getPlayer(to);
        if (receiver && receiver.notifications) {
            // Could send push notification here
        }
    }

    static getMessages(phone, unreadOnly = false) {
        const db = Database.get();
        let query = 'SELECT * FROM messages WHERE phone = ? AND archived = 0';
        if (unreadOnly) query += ' AND read = 0';
        query += ' ORDER BY created_at DESC';
        
        return db.prepare(query).all(phone);
    }

    static getUnreadCount(phone) {
        const db = Database.get();
        return db.prepare(`
            SELECT COUNT(*) as count FROM messages 
            WHERE phone = ? AND read = 0 AND archived = 0
        `).get(phone).count;
    }

    static readMessage(messageId, phone) {
        const db = Database.get();
        db.prepare(`
            UPDATE messages SET read = 1, read_at = CURRENT_TIMESTAMP 
            WHERE id = ? AND phone = ?
        `).run(messageId, phone);
    }

    static deleteMessage(messageId, phone) {
        const db = Database.get();
        db.prepare('DELETE FROM messages WHERE id = ? AND phone = ?').run(messageId, phone);
    }

    static clearInbox(phone) {
        const db = Database.get();
        db.prepare('DELETE FROM messages WHERE phone = ?').run(phone);
    }

    // ==================== UTILITY ====================

    static isAdmin(phone) {
        return phone === process.env.ADMIN_NUMBER;
    }

    static checkRateLimit(phone) {
        // Simple rate limiting - could be enhanced with Redis
        const db = Database.get();
        const config = global.gameConfig;
        
        // Check if we have a recent log entry
        const recent = db.prepare(`
            SELECT COUNT(*) as count FROM logs 
            WHERE phone = ? AND created_at > datetime('now', '-1 minute')
        `).get(phone).count;
        
        return recent < (config.security?.maxCommandsPerMinute || 20);
    }

    static logAction(action, phone, details) {
        const db = Database.get();
        db.prepare(`
            INSERT INTO logs (action, phone, details, category)
            VALUES (?, ?, ?, ?)
        `).run(action, phone, JSON.stringify(details), this.categorizeAction(action));
    }

    static categorizeAction(action) {
        if (action.includes('battle') || action.includes('attack')) return 'combat';
        if (action.includes('trade') || action.includes('steal')) return 'economy';
        if (action.includes('pet')) return 'pets';
        if (action.includes('admin')) return 'admin';
        if (action.includes('ban') || action.includes('mute')) return 'moderation';
        return 'general';
    }

    static getStats() {
        const db = Database.get();
        
        return {
            totalPlayers: db.prepare('SELECT COUNT(*) as count FROM players').get().count,
            activeToday: db.prepare(`
                SELECT COUNT(*) as count FROM players 
                WHERE last_active > datetime('now', '-1 day')
            `).get().count,
            totalBattles: db.prepare('SELECT COUNT(*) as count FROM active_battles').get().count,
            activeBattles: db.prepare(`
                SELECT COUNT(*) as count FROM active_battles 
                WHERE status = 'active'
            `).get().count,
            totalPets: db.prepare('SELECT COUNT(*) as count FROM pets').get().count,
            totalTrades: db.prepare('SELECT COUNT(*) as count FROM trades').get().count,
            totalPoints: db.prepare('SELECT SUM(points) as sum FROM players').get().sum || 0
        };
    }

    // ==================== BAN/MODERATION ====================

    static banPlayer(phone, reason, duration = null) {
        const expires = duration ? moment().add(duration, 'hours').toISOString() : null;
        this.updatePlayer(phone, { 
            banned: 1, 
            ban_reason: reason,
            ban_expires: expires
        });
        this.logAction('banned', phone, { reason, duration });
    }

    static unbanPlayer(phone) {
        this.updatePlayer(phone, { 
            banned: 0, 
            ban_reason: null,
            ban_expires: null
        });
        this.logAction('unbanned', phone, {});
    }

    static isBanned(phone) {
        const player = this.getPlayer(phone);
        if (!player || !player.banned) return false;
        
        // Check if ban expired
        if (player.ban_expires && moment(player.ban_expires).isBefore(moment())) {
            this.unbanPlayer(phone);
            return false;
        }
        
        return true;
    }

    // ==================== BACKUP/RESTORE ====================

    static backupDatabase() {
        Database.backup();
    }
}

module.exports = GameEngine;
