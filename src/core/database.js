const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

let db = null;

class DatabaseManager {
    static init() {
        const dbPath = process.env.DB_PATH || './database/rpg_bot.db';
        fs.ensureDirSync(path.dirname(dbPath));
        
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('temp_store = MEMORY');
        db.pragma('mmap_size = 30000000000');
        
        this.createTables();
        this.createIndexes();
        console.log('[✓] Database initialized:', dbPath);
        return db;
    }

    static createTables() {
        // Players
        db.exec(`
            CREATE TABLE IF NOT EXISTS players (
                phone TEXT PRIMARY KEY,
                name TEXT DEFAULT 'Player',
                username TEXT UNIQUE,
                level INTEGER DEFAULT 1,
                exp INTEGER DEFAULT 0,
                hp INTEGER DEFAULT 100,
                max_hp INTEGER DEFAULT 100,
                attack INTEGER DEFAULT 10,
                defense INTEGER DEFAULT 5,
                speed INTEGER DEFAULT 5,
                points INTEGER DEFAULT 0,
                total_earned INTEGER DEFAULT 0,
                total_spent INTEGER DEFAULT 0,
                bank_points INTEGER DEFAULT 0,
                bank_tier INTEGER DEFAULT 1,
                last_daily TEXT,
                daily_streak INTEGER DEFAULT 0,
                last_steal TEXT,
                steals_today INTEGER DEFAULT 0,
                last_pvp TEXT,
                pvp_streak INTEGER DEFAULT 0,
                shield_active INTEGER DEFAULT 0,
                shield_expires TEXT,
                rank TEXT DEFAULT 'Bronze',
                elo INTEGER DEFAULT 1000,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                draws INTEGER DEFAULT 0,
                equipped_pet INTEGER DEFAULT NULL,
                active_effects TEXT DEFAULT '{}',
                banned INTEGER DEFAULT 0,
                ban_reason TEXT,
                ban_expires TEXT,
                warned INTEGER DEFAULT 0,
                language TEXT DEFAULT 'en',
                notifications INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                last_active TEXT DEFAULT CURRENT_TIMESTAMP,
                play_time_minutes INTEGER DEFAULT 0
            )
        `);

        // Pets
        db.exec(`
            CREATE TABLE IF NOT EXISTS pets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_phone TEXT NOT NULL,
                name TEXT,
                rarity TEXT DEFAULT 'Common',
                type TEXT,
                level INTEGER DEFAULT 1,
                exp INTEGER DEFAULT 0,
                hp_bonus INTEGER DEFAULT 0,
                attack_bonus INTEGER DEFAULT 0,
                defense_bonus INTEGER DEFAULT 0,
                speed_bonus INTEGER DEFAULT 0,
                special_attack TEXT,
                equipped INTEGER DEFAULT 0,
                favorite INTEGER DEFAULT 0,
                obtained_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_phone) REFERENCES players(phone) ON DELETE CASCADE
            )
        `);

        // Inventory
        db.exec(`
            CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                item_id TEXT,
                item_type TEXT,
                item_name TEXT,
                quantity INTEGER DEFAULT 1,
                equipped INTEGER DEFAULT 0,
                durability INTEGER,
                max_durability INTEGER,
                stats TEXT,
                obtained_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (phone) REFERENCES players(phone) ON DELETE CASCADE
            )
        `);

        // Active Battles (PvE)
        db.exec(`
            CREATE TABLE IF NOT EXISTS active_battles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                enemy_id TEXT,
                enemy_name TEXT,
                enemy_level INTEGER,
                enemy_hp INTEGER,
                enemy_max_hp INTEGER,
                enemy_attack INTEGER,
                enemy_defense INTEGER,
                enemy_speed INTEGER,
                player_hp INTEGER,
                player_max_hp INTEGER,
                turn INTEGER DEFAULT 1,
                status TEXT DEFAULT 'active',
                battle_type TEXT DEFAULT 'normal',
                rewards TEXT,
                started_at TEXT DEFAULT CURRENT_TIMESTAMP,
                last_action TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (phone) REFERENCES players(phone) ON DELETE CASCADE
            )
        `);

        // PvP Matches
        db.exec(`
            CREATE TABLE IF NOT EXISTS pvp_matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challenger_phone TEXT NOT NULL,
                opponent_phone TEXT,
                status TEXT DEFAULT 'pending',
                winner_phone TEXT,
                challenger_hp INTEGER,
                opponent_hp INTEGER,
                challenger_deck TEXT,
                opponent_deck TEXT,
                turns INTEGER DEFAULT 0,
                started_at TEXT,
                ended_at TEXT,
                challenger_ready INTEGER DEFAULT 0,
                opponent_ready INTEGER DEFAULT 0,
                FOREIGN KEY (challenger_phone) REFERENCES players(phone),
                FOREIGN KEY (opponent_phone) REFERENCES players(phone)
            )
        `);

        // Group Battles
        db.exec(`
            CREATE TABLE IF NOT EXISTS group_battles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT NOT NULL,
                boss_id TEXT,
                boss_name TEXT,
                boss_hp INTEGER,
                boss_max_hp INTEGER,
                boss_attack INTEGER,
                boss_defense INTEGER,
                status TEXT DEFAULT 'waiting',
                min_players INTEGER DEFAULT 2,
                max_players INTEGER DEFAULT 5,
                current_players INTEGER DEFAULT 0,
                rewards TEXT,
                started_at TEXT,
                ended_at TEXT,
                created_by TEXT,
                FOREIGN KEY (created_by) REFERENCES players(phone)
            )
        `);

        // Group Battle Participants
        db.exec(`
            CREATE TABLE IF NOT EXISTS group_battle_participants (
                battle_id INTEGER,
                phone TEXT,
                hp INTEGER,
                max_hp INTEGER,
                damage_dealt INTEGER DEFAULT 0,
                healing_done INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active',
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (battle_id) REFERENCES group_battles(id) ON DELETE CASCADE,
                FOREIGN KEY (phone) REFERENCES players(phone)
            )
        `);

        // World Bosses
        db.exec(`
            CREATE TABLE IF NOT EXISTS world_bosses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                boss_id TEXT UNIQUE,
                name TEXT,
                hp INTEGER,
                max_hp INTEGER,
                attack INTEGER,
                defense INTEGER,
                speed INTEGER,
                status TEXT DEFAULT 'active',
                spawned_by TEXT,
                spawn_message TEXT,
                defeat_message TEXT,
                rewards TEXT,
                total_damage INTEGER DEFAULT 0,
                killers_count INTEGER DEFAULT 0,
                spawned_at TEXT DEFAULT CURRENT_TIMESTAMP,
                defeated_at TEXT,
                expires_at TEXT
            )
        `);

        // World Boss Damage
        db.exec(`
            CREATE TABLE IF NOT EXISTS world_boss_damage (
                boss_id INTEGER,
                phone TEXT,
                damage INTEGER DEFAULT 0,
                hits INTEGER DEFAULT 0,
                last_hit TEXT,
                FOREIGN KEY (boss_id) REFERENCES world_bosses(id) ON DELETE CASCADE,
                FOREIGN KEY (phone) REFERENCES players(phone)
            )
        `);

        // Trades
        db.exec(`
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id TEXT UNIQUE,
                sender_phone TEXT NOT NULL,
                receiver_phone TEXT NOT NULL,
                sender_pets TEXT,
                sender_items TEXT,
                sender_points INTEGER DEFAULT 0,
                receiver_pets TEXT,
                receiver_items TEXT,
                receiver_points INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                sender_confirmed INTEGER DEFAULT 0,
                receiver_confirmed INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                expires_at TEXT,
                completed_at TEXT,
                FOREIGN KEY (sender_phone) REFERENCES players(phone),
                FOREIGN KEY (receiver_phone) REFERENCES players(phone)
            )
        `);

        // Messages (Inbox)
        db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                sender TEXT,
                sender_name TEXT,
                title TEXT,
                content TEXT,
                type TEXT DEFAULT 'system',
                category TEXT DEFAULT 'general',
                attachments TEXT,
                read INTEGER DEFAULT 0,
                archived INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                read_at TEXT,
                FOREIGN KEY (phone) REFERENCES players(phone) ON DELETE CASCADE
            )
        `);

        // Achievements
        db.exec(`
            CREATE TABLE IF NOT EXISTS achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                achievement_id TEXT,
                name TEXT,
                description TEXT,
                category TEXT,
                unlocked_at TEXT DEFAULT CURRENT_TIMESTAMP,
                progress INTEGER DEFAULT 0,
                max_progress INTEGER,
                reward_claimed INTEGER DEFAULT 0,
                FOREIGN KEY (phone) REFERENCES players(phone) ON DELETE CASCADE
            )
        `);

        // Quests
        db.exec(`
            CREATE TABLE IF NOT EXISTS quests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                quest_id TEXT,
                name TEXT,
                description TEXT,
                type TEXT,
                requirements TEXT,
                rewards TEXT,
                status TEXT DEFAULT 'active',
                progress INTEGER DEFAULT 0,
                target INTEGER,
                started_at TEXT DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT,
                expires_at TEXT,
                FOREIGN KEY (phone) REFERENCES players(phone) ON DELETE CASCADE
            )
        `);

        // Guilds/Clans
        db.exec(`
            CREATE TABLE IF NOT EXISTS guilds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT UNIQUE,
                name TEXT,
                tag TEXT,
                description TEXT,
                leader_phone TEXT,
                co_leaders TEXT,
                members TEXT,
                max_members INTEGER DEFAULT 20,
                level INTEGER DEFAULT 1,
                exp INTEGER DEFAULT 0,
                treasury INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (leader_phone) REFERENCES players(phone)
            )
        `);

        // Guild Members
        db.exec(`
            CREATE TABLE IF NOT EXISTS guild_members (
                guild_id INTEGER,
                phone TEXT,
                rank TEXT DEFAULT 'member',
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                contribution INTEGER DEFAULT 0,
                FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
                FOREIGN KEY (phone) REFERENCES players(phone)
            )
        `);

        // Market/Listings
        db.exec(`
            CREATE TABLE IF NOT EXISTS market (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seller_phone TEXT,
                item_type TEXT,
                item_id INTEGER,
                item_name TEXT,
                quantity INTEGER,
                price INTEGER,
                listed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                expires_at TEXT,
                sold INTEGER DEFAULT 0,
                buyer_phone TEXT,
                sold_at TEXT,
                FOREIGN KEY (seller_phone) REFERENCES players(phone)
            )
        `);

        // Logs
        db.exec(`
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT,
                category TEXT,
                phone TEXT,
                target_phone TEXT,
                details TEXT,
                ip_address TEXT,
                user_agent TEXT,
                success INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Sessions for web dashboard (if implemented)
        db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT,
                session_token TEXT UNIQUE,
                expires_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (phone) REFERENCES players(phone) ON DELETE CASCADE
            )
        `);

        // Settings per player
        db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                phone TEXT PRIMARY KEY,
                notifications INTEGER DEFAULT 1,
                compact_mode INTEGER DEFAULT 0,
                auto_battle INTEGER DEFAULT 0,
                language TEXT DEFAULT 'en',
                theme TEXT DEFAULT 'default',
                privacy_level INTEGER DEFAULT 1,
                FOREIGN KEY (phone) REFERENCES players(phone) ON DELETE CASCADE
            )
        `);
    }

    static createIndexes() {
        // Performance indexes
        db.exec('CREATE INDEX IF NOT EXISTS idx_pets_owner ON pets(owner_phone)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_pets_equipped ON pets(owner_phone, equipped)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_phone ON inventory(phone)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_battles_phone ON active_battles(phone, status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_battles_status ON active_battles(status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_pvp_challenger ON pvp_matches(challenger_phone, status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_pvp_opponent ON pvp_matches(opponent_phone, status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_group_battle_group ON group_battles(group_id, status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_world_boss_status ON world_bosses(status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_world_boss_damage_boss ON world_boss_damage(boss_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_world_boss_damage_phone ON world_boss_damage(phone)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_trades_sender ON trades(sender_phone, status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_trades_receiver ON trades(receiver_phone, status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone, read)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_achievements_phone ON achievements(phone)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_quests_phone ON quests(phone, status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_guild_members_phone ON guild_members(phone)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_market_seller ON market(seller_phone, sold)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_logs_phone ON logs(phone, created_at)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action, created_at)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_players_elo ON players(elo DESC)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_players_level ON players(level DESC, exp DESC)');
    }

    static get() {
        if (!db) this.init();
        return db;
    }

    static close() {
        if (db) {
            db.close();
            db = null;
            console.log('[✓] Database connection closed');
        }
    }

    static backup() {
        const backupPath = `./database/backup_${Date.now()}.db`;
        db.backup(backupPath)
            .then(() => console.log('[✓] Database backed up to:', backupPath))
            .catch(err => console.error('[!] Backup failed:', err));
    }
}

module.exports = DatabaseManager;
