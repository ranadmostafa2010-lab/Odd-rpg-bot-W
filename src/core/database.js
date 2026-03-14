
database_js = """const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

class Database {
    constructor() {
        this.dbPath = process.env.DB_PATH || './database/rpg_bot.db';
        this.db = null;
    }

    async initialize() {
        await fs.ensureDir(path.dirname(this.dbPath));
        
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error(chalk.red('Database connection failed:'), err);
                    reject(err);
                } else {
                    console.log(chalk.green('✅ Connected to SQLite database'));
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }

    async createTables() {
        const tables = [
            // Players table - enhanced with PvP stats
            `CREATE TABLE IF NOT EXISTS players (
                phone TEXT PRIMARY KEY,
                name TEXT DEFAULT 'Player',
                points INTEGER DEFAULT 0,
                power INTEGER DEFAULT 10,
                hp INTEGER DEFAULT 100,
                max_hp INTEGER DEFAULT 100,
                level INTEGER DEFAULT 1,
                exp INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                pvp_wins INTEGER DEFAULT 0,
                pvp_losses INTEGER DEFAULT 0,
                elo_rating INTEGER DEFAULT 1000,
                rank_tier TEXT DEFAULT 'bronze',
                bank_tier TEXT DEFAULT 'basic',
                bank_balance INTEGER DEFAULT 0,
                last_daily TEXT,
                last_steal TEXT,
                last_pvp TEXT,
                shield_active INTEGER DEFAULT 0,
                shield_expires TEXT,
                xp_boost_expires TEXT,
                luck_boost_expires TEXT,
                status TEXT DEFAULT 'offline',
                last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
                banned INTEGER DEFAULT 0,
                ban_reason TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,

            // Pets table
            `CREATE TABLE IF NOT EXISTS pets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_phone TEXT,
                name TEXT,
                rarity TEXT,
                atk INTEGER DEFAULT 0,
                special_name TEXT,
                equipped INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_phone) REFERENCES players(phone) ON DELETE CASCADE
            )`,

            // Inventory table
            `CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT,
                item_type TEXT,
                item_name TEXT,
                quantity INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (phone) REFERENCES players(phone) ON DELETE CASCADE
            )`,

            // Messages/Inbox table
            `CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_phone TEXT,
                to_phone TEXT,
                message TEXT,
                read INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_phone) REFERENCES players(phone),
                FOREIGN KEY (to_phone) REFERENCES players(phone)
            )`,

            // Trades table
            `CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_phone TEXT,
                to_phone TEXT,
                offer_pet_id INTEGER,
                offer_points INTEGER DEFAULT 0,
                request_pet_id INTEGER,
                request_points INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_phone) REFERENCES players(phone),
                FOREIGN KEY (to_phone) REFERENCES players(phone)
            )`,

            // PvP Matches table
            `CREATE TABLE IF NOT EXISTS pvp_matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player1_phone TEXT,
                player2_phone TEXT,
                winner_phone TEXT,
                player1_damage INTEGER DEFAULT 0,
                player2_damage INTEGER DEFAULT 0,
                elo_change INTEGER DEFAULT 0,
                match_type TEXT DEFAULT 'ranked',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player1_phone) REFERENCES players(phone),
                FOREIGN KEY (player2_phone) REFERENCES players(phone)
            )`,

            // Group Battles table
            `CREATE TABLE IF NOT EXISTS group_battles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                creator_phone TEXT,
                group_jid TEXT,
                status TEXT DEFAULT 'waiting',
                max_players INTEGER DEFAULT 5,
                current_players INTEGER DEFAULT 1,
                enemy_name TEXT,
                enemy_hp INTEGER,
                enemy_max_hp INTEGER,
                rewards TEXT,
                started_at TEXT,
                ended_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (creator_phone) REFERENCES players(phone)
            )`,

            // Group Battle Participants table
            `CREATE TABLE IF NOT EXISTS group_battle_participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                battle_id INTEGER,
                phone TEXT,
                damage_dealt INTEGER DEFAULT 0,
                healing_done INTEGER DEFAULT 0,
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (battle_id) REFERENCES group_battles(id) ON DELETE CASCADE,
                FOREIGN KEY (phone) REFERENCES players(phone)
            )`,

            // World Bosses table
            `CREATE TABLE IF NOT EXISTS world_bosses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                boss_name TEXT,
                boss_hp INTEGER,
                boss_max_hp INTEGER,
                active INTEGER DEFAULT 1,
                spawned_by TEXT,
                spawned_at TEXT DEFAULT CURRENT_TIMESTAMP,
                defeated_at TEXT,
                FOREIGN KEY (spawned_by) REFERENCES players(phone)
            )`,

            // World Boss Participants table
            `CREATE TABLE IF NOT EXISTS world_boss_participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                boss_id INTEGER,
                phone TEXT,
                damage_dealt INTEGER DEFAULT 0,
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (boss_id) REFERENCES world_bosses(id) ON DELETE CASCADE,
                FOREIGN KEY (phone) REFERENCES players(phone)
            )`,

            // Active Battles table (for message editing)
            `CREATE TABLE IF NOT EXISTS active_battles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT UNIQUE,
                battle_type TEXT,
                enemy_data TEXT,
                player_hp INTEGER,
                enemy_hp INTEGER,
                turn INTEGER DEFAULT 1,
                message_id TEXT,
                chat_jid TEXT,
                started_at TEXT DEFAULT CURRENT_TIMESTAMP,
                last_action TEXT,
                FOREIGN KEY (phone) REFERENCES players(phone) ON DELETE CASCADE
            )`,

            // Promo codes usage table
            `CREATE TABLE IF NOT EXISTS promo_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT,
                code TEXT,
                used_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (phone) REFERENCES players(phone)
            )`,

            // Steal logs table
            `CREATE TABLE IF NOT EXISTS steal_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thief_phone TEXT,
                victim_phone TEXT,
                amount INTEGER,
                success INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (thief_phone) REFERENCES players(phone),
                FOREIGN KEY (victim_phone) REFERENCES players(phone)
            )`,

            // Game logs table
            `CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT,
                action TEXT,
                details TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (phone) REFERENCES players(phone)
            )`,

            // Ranked Season table
            `CREATE TABLE IF NOT EXISTS ranked_seasons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                season_number INTEGER,
                start_date TEXT,
                end_date TEXT,
                status TEXT DEFAULT 'active'
            )`
        ];

        for (const sql of tables) {
            await this.run(sql);
        }

        console.log(chalk.green('✅ Database tables created'));
    }

    // Promise wrappers
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Player methods
    async getPlayer(phone) {
        return await this.get('SELECT * FROM players WHERE phone = ?', [phone]);
    }

    async createPlayer(phone, name = 'Player') {
        await this.run(
            'INSERT INTO players (phone, name) VALUES (?, ?)',
            [phone, name]
        );
        return await this.getPlayer(phone);
    }

    async updatePlayer(phone, updates) {
        const keys = Object.keys(updates);
        const values = Object.values(updates);
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        
        await this.run(
            `UPDATE players SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE phone = ?`,
            [...values, phone]
        );
        return await this.getPlayer(phone);
    }

    async updateStatus(phone, status) {
        await this.run(
            'UPDATE players SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE phone = ?',
            [status, phone]
        );
    }

    async getOnlinePlayers() {
        return await this.all(
            "SELECT * FROM players WHERE status = 'online' AND banned = 0"
        );
    }

    async getAllPlayers() {
        return await this.all('SELECT * FROM players WHERE banned = 0');
    }

    async getLeaderboard(limit = 10) {
        return await this.all(
            'SELECT phone, name, points, wins, pvp_wins, level, elo_rating, rank_tier FROM players WHERE banned = 0 ORDER BY points DESC LIMIT ?',
            [limit]
        );
    }

    async getPvPLeaderboard(limit = 10) {
        return await this.all(
            'SELECT phone, name, pvp_wins, pvp_losses, elo_rating, rank_tier FROM players WHERE banned = 0 ORDER BY elo_rating DESC LIMIT ?',
            [limit]
        );
    }

    // Pet methods
    async getPets(phone) {
        return await this.all('SELECT * FROM pets WHERE owner_phone = ?', [phone]);
    }

    async getEquippedPet(phone) {
        return await this.get('SELECT * FROM pets WHERE owner_phone = ? AND equipped = 1', [phone]);
    }

    async addPet(phone, petData) {
        const result = await this.run(
            'INSERT INTO pets (owner_phone, name, rarity, atk, special_name) VALUES (?, ?, ?, ?, ?)',
            [phone, petData.name, petData.rarity, petData.atk, petData.special_name || null]
        );
        return await this.get('SELECT * FROM pets WHERE id = ?', [result.id]);
    }

    async equipPet(phone, petId) {
        await this.run('UPDATE pets SET equipped = 0 WHERE owner_phone = ?', [phone]);
        await this.run('UPDATE pets SET equipped = 1 WHERE id = ? AND owner_phone = ?', [petId, phone]);
        return await this.get('SELECT * FROM pets WHERE id = ?', [petId]);
    }

    async deletePet(petId) {
        await this.run('DELETE FROM pets WHERE id = ?', [petId]);
    }

    // Inventory methods
    async getInventory(phone) {
        return await this.all('SELECT * FROM inventory WHERE phone = ?', [phone]);
    }

    async addItem(phone, itemType, itemName, quantity = 1) {
        const existing = await this.get(
            'SELECT * FROM inventory WHERE phone = ? AND item_type = ? AND item_name = ?',
            [phone, itemType, itemName]
        );
        
        if (existing) {
            await this.run(
                'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                [quantity, existing.id]
            );
        } else {
            await this.run(
                'INSERT INTO inventory (phone, item_type, item_name, quantity) VALUES (?, ?, ?, ?)',
                [phone, itemType, itemName, quantity]
            );
        }
    }

    async removeItem(phone, itemType, itemName, quantity = 1) {
        const existing = await this.get(
            'SELECT * FROM inventory WHERE phone = ? AND item_type = ? AND item_name = ?',
            [phone, itemType, itemName]
        );
        
        if (existing) {
            if (existing.quantity <= quantity) {
                await this.run('DELETE FROM inventory WHERE id = ?', [existing.id]);
            } else {
                await this.run(
                    'UPDATE inventory SET quantity = quantity - ? WHERE id = ?',
                    [quantity, existing.id]
                );
            }
        }
    }

    // Message methods
    async sendMessage(fromPhone, toPhone, message) {
        await this.run(
            'INSERT INTO messages (from_phone, to_phone, message) VALUES (?, ?, ?)',
            [fromPhone, toPhone, message]
        );
    }

    async getInbox(phone) {
        return await this.all(
            'SELECT m.*, p.name as from_name FROM messages m JOIN players p ON m.from_phone = p.phone WHERE m.to_phone = ? ORDER BY m.created_at DESC LIMIT 50',
            [phone]
        );
    }

    async markAsRead(messageId) {
        await this.run('UPDATE messages SET read = 1 WHERE id = ?', [messageId]);
    }

    // Trade methods
    async createTrade(tradeData) {
        const result = await this.run(
            'INSERT INTO trades (from_phone, to_phone, offer_pet_id, offer_points, request_pet_id, request_points) VALUES (?, ?, ?, ?, ?, ?)',
            [tradeData.from_phone, tradeData.to_phone, tradeData.offer_pet_id, tradeData.offer_points, tradeData.request_pet_id, tradeData.request_points]
        );
        return await this.get('SELECT * FROM trades WHERE id = ?', [result.id]);
    }

    async getPendingTrades(phone) {
        return await this.all(
            'SELECT * FROM trades WHERE to_phone = ? AND status = "pending"',
            [phone]
        );
    }

    async updateTradeStatus(tradeId, status) {
        await this.run('UPDATE trades SET status = ? WHERE id = ?', [status, tradeId]);
    }

    // PvP methods
    async recordPvPMatch(player1, player2, winner, damage1, damage2, eloChange) {
        await this.run(
            'INSERT INTO pvp_matches (player1_phone, player2_phone, winner_phone, player1_damage, player2_damage, elo_change) VALUES (?, ?, ?, ?, ?, ?)',
            [player1, player2, winner, damage1, damage2, eloChange]
        );
    }

    // Active Battle methods (for message editing)
    async createActiveBattle(phone, battleData) {
        await this.run(
            'INSERT OR REPLACE INTO active_battles (phone, battle_type, enemy_data, player_hp, enemy_hp, message_id, chat_jid) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [phone, battleData.type, JSON.stringify(battleData.enemy), battleData.playerHp, battleData.enemyHp, battleData.messageId, battleData.chatJid]
        );
    }

    async getActiveBattle(phone) {
        return await this.get('SELECT * FROM active_battles WHERE phone = ?', [phone]);
    }

    async updateBattle(phone, updates) {
        const keys = Object.keys(updates);
        const values = Object.values(updates);
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        
        await this.run(
            `UPDATE active_battles SET ${setClause} WHERE phone = ?`,
            [...values, phone]
        );
    }

    async deleteActiveBattle(phone) {
        await this.run('DELETE FROM active_battles WHERE phone = ?', [phone]);
    }

    // Group Battle methods
    async createGroupBattle(creatorPhone, groupJid, battleData) {
        const result = await this.run(
            'INSERT INTO group_battles (creator_phone, group_jid, enemy_name, enemy_hp, enemy_max_hp, rewards, max_players) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [creatorPhone, groupJid, battleData.enemyName, battleData.enemyHp, battleData.enemyHp, JSON.stringify(battleData.rewards), battleData.maxPlayers || 5]
        );
        
        // Add creator as first participant
        await this.run(
            'INSERT INTO group_battle_participants (battle_id, phone) VALUES (?, ?)',
            [result.id, creatorPhone]
        );
        
        return result.id;
    }

    async getActiveGroupBattle(groupJid) {
        return await this.get(
            'SELECT * FROM group_battles WHERE group_jid = ? AND status IN ("waiting", "active")',
            [groupJid]
        );
    }

    async joinGroupBattle(battleId, phone) {
        await this.run(
            'INSERT INTO group_battle_participants (battle_id, phone) VALUES (?, ?)',
            [battleId, phone]
        );
        await this.run(
            'UPDATE group_battles SET current_players = current_players + 1 WHERE id = ?',
            [battleId]
        );
    }

    async getGroupBattleParticipants(battleId) {
        return await this.all(
            'SELECT gbp.*, p.name, p.power FROM group_battle_participants gbp JOIN players p ON gbp.phone = p.phone WHERE gbp.battle_id = ?',
            [battleId]
        );
    }

    async updateGroupBattleDamage(battleId, phone, damage) {
        await this.run(
            'UPDATE group_battle_participants SET damage_dealt = damage_dealt + ? WHERE battle_id = ? AND phone = ?',
            [damage, battleId, phone]
        );
    }

    async updateGroupBattleStatus(battleId, status) {
        await this.run('UPDATE group_battles SET status = ? WHERE id = ?', [status, battleId]);
    }

    // World Boss methods
    async getActiveWorldBoss() {
        return await this.get('SELECT * FROM world_bosses WHERE active = 1');
    }

    async spawnWorldBoss(bossData, spawnedBy) {
        const result = await this.run(
            'INSERT INTO world_bosses (boss_name, boss_hp, boss_max_hp, spawned_by) VALUES (?, ?, ?, ?)',
            [bossData.name, bossData.hp, bossData.hp, spawnedBy]
        );
        return await this.get('SELECT * FROM world_bosses WHERE id = ?', [result.id]);
    }

    async updateWorldBossHp(bossId, damage) {
        await this.run(
            'UPDATE world_bosses SET boss_hp = boss_hp - ? WHERE id = ?',
            [damage, bossId]
        );
        return await this.get('SELECT * FROM world_bosses WHERE id = ?', [bossId]);
    }

    async defeatWorldBoss(bossId) {
        await this.run(
            'UPDATE world_bosses SET active = 0, defeated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [bossId]
        );
    }

    async addWorldBossParticipant(bossId, phone) {
        await this.run(
            'INSERT OR IGNORE INTO world_boss_participants (boss_id, phone) VALUES (?, ?)',
            [bossId, phone]
        );
    }

    async updateWorldBossDamage(bossId, phone, damage) {
        await this.run(
            'UPDATE world_boss_participants SET damage_dealt = damage_dealt + ? WHERE boss_id = ? AND phone = ?',
            [damage, bossId, phone]
        );
    }

    async getWorldBossParticipants(bossId) {
        return await this.all(
            'SELECT wbp.*, p.name FROM world_boss_participants wbp JOIN players p ON wbp.phone = p.phone WHERE wbp.boss_id = ? ORDER BY wbp.damage_dealt DESC',
            [bossId]
        );
    }

    // Steal methods
    async logSteal(thiefPhone, victimPhone, amount, success) {
        await this.run(
            'INSERT INTO steal_logs (thief_phone, victim_phone, amount, success) VALUES (?, ?, ?, ?)',
            [thiefPhone, victimPhone, amount, success ? 1 : 0]
        );
    }

    // Promo code methods
    async hasUsedCode(phone, code) {
        const row = await this.get(
            'SELECT * FROM promo_usage WHERE phone = ? AND code = ?',
            [phone, code]
        );
        return !!row;
    }

    async recordCodeUsage(phone, code) {
        await this.run(
            'INSERT INTO promo_usage (phone, code) VALUES (?, ?)',
            [phone, code]
        );
    }

    // Logging
    async logAction(phone, action, details = '') {
        await this.run(
            'INSERT INTO logs (phone, action, details) VALUES (?, ?, ?)',
            [phone, action, details]
        );
    }

    // Backup
    async backup() {
        const backupPath = `${this.dbPath}.backup.${Date.now()}`;
        await fs.copy(this.dbPath, backupPath);
        console.log(chalk.green(`✅ Database backed up to: ${backupPath}`));
        
        // Keep only last 5 backups
        const dir = path.dirname(this.dbPath);
        const files = await fs.readdir(dir);
        const backups = files
            .filter(f => f.startsWith('rpg_bot.db.backup'))
            .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtime }))
            .sort((a, b) => b.time - a.time);
        
        if (backups.length > 5) {
            for (const old of backups.slice(5)) {
                await fs.remove(path.join(dir, old.name));
            }
        }
    }

    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) console.error(chalk.red('Error closing database:'), err);
                    else console.log(chalk.green('✅ Database connection closed'));
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/core/database.js', 'w') as f:
    f.write(database_js)

print("✅ 5. src/core/database.js created")