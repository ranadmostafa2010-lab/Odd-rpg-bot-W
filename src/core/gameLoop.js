const cron = require('node-cron');
const BankSystem = require('../system/bankSystem');
const WorldBossSystem = require('../system/worldBossSystem');
const QuestSystem = require('../system/questSystem');

class GameLoop {
    static sock = null;

    static start(sock) {
        this.sock = sock;
        const config = global.gameConfig;

        console.log('[✓] Starting game loops...');

        // Daily interest at midnight
        if (config.features.bankInterest) {
            cron.schedule('0 0 * * *', () => {
                console.log('[Cron] Applying daily interest...');
                BankSystem.applyDailyInterest();
            });
        }

        // Cleanup old battles every 10 minutes
        cron.schedule('*/10 * * * *', () => {
            console.log('[Cron] Cleaning up old battles...');
            this.cleanupOldBattles();
        });

        // Generate new daily quests at midnight
        cron.schedule('0 0 * * *', () => {
            console.log('[Cron] Generating new daily quests...');
            this.generateNewQuests();
        });

        // World boss auto-spawn check
        if (config.features.worldBosses) {
            WorldBossSystem.startAutoSpawn(sock);
        }

        // Database backup daily
        cron.schedule('0 0 * * *', () => {
            console.log('[Cron] Creating database backup...');
            const Database = require('./database');
            Database.backup();
        });

        // Log active players hourly
        cron.schedule('0 * * * *', () => {
            this.logHourlyStats();
        });

        console.log('[✓] All game loops started');
    }

    static cleanupOldBattles() {
        const Database = require('./database');
        const db = Database.get();
        
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        
        // Expire old PvE battles
        db.prepare(`
            UPDATE active_battles 
            SET status = 'expired' 
            WHERE status = 'active' AND last_action < ?
        `).run(tenMinutesAgo);

        // Expire old PvP matches
        db.prepare(`
            UPDATE pvp_matches 
            SET status = 'expired' 
            WHERE status = 'pending' AND started_at < ?
        `).run(tenMinutesAgo);

        // Expire old trades
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        db.prepare(`
            UPDATE trades 
            SET status = 'expired' 
            WHERE status = 'pending' AND created_at < ?
        `).run(oneHourAgo);

        console.log('[Cron] Cleanup complete');
    }

    static generateNewQuests() {
        const Database = require('./database');
        const db = Database.get();
        
        const players = db.prepare('SELECT phone FROM players WHERE banned = 0').all();
        
        for (const player of players) {
            QuestSystem.generateDailyQuests(player.phone);
        }
        
        console.log(`[Cron] Generated quests for ${players.length} players`);
    }

    static logHourlyStats() {
        const Database = require('./database');
        const db = Database.get();
        
        const stats = {
            online: db.prepare("SELECT COUNT(*) as c FROM players WHERE last_active > datetime('now', '-1 hour')").get().c,
            battles: db.prepare("SELECT COUNT(*) as c FROM active_battles WHERE status = 'active'").get().c,
            pvp: db.prepare("SELECT COUNT(*) as c FROM pvp_matches WHERE status = 'active'").get().c
        };
        
        console.log(`[Stats] Online: ${stats.online}, Battles: ${stats.battles}, PvP: ${stats.pvp}`);
    }
}

module.exports = GameLoop;
