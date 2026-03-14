const Database = require('../core/database');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');

class BackupUtil {
    static backupDir = './backups';

    static async create() {
        const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
        const backupPath = path.join(this.backupDir, `backup_${timestamp}.db`);
        
        try {
            await fs.ensureDir(this.backupDir);
            
            const dbPath = process.env.DB_PATH || './database/rpg_bot.db';
            await fs.copy(dbPath, backupPath);
            
            console.log(`[✓] Backup created: ${backupPath}`);
            
            // Clean old backups
            await this.cleanOldBackups();
            
            return { success: true, path: backupPath };
        } catch (err) {
            console.error('[!] Backup failed:', err.message);
            return { success: false, error: err.message };
        }
    }

    static async restore(backupFile) {
        const backupPath = path.join(this.backupDir, backupFile);
        const dbPath = process.env.DB_PATH || './database/rpg_bot.db';
        
        try {
            if (!await fs.pathExists(backupPath)) {
                return { success: false, error: 'Backup file not found' };
            }

            // Create emergency backup of current state
            const emergencyBackup = path.join(this.backupDir, `emergency_${moment().format('YYYY-MM-DD_HH-mm-ss')}.db`);
            await fs.copy(dbPath, emergencyBackup);
            
            // Restore
            await fs.copy(backupPath, dbPath);
            
            console.log(`[✓] Database restored from: ${backupPath}`);
            console.log(`[i] Emergency backup saved to: ${emergencyBackup}`);
            
            return { success: true };
        } catch (err) {
            console.error('[!] Restore failed:', err.message);
            return { success: false, error: err.message };
        }
    }

    static async list() {
        try {
            await fs.ensureDir(this.backupDir);
            const files = await fs.readdir(this.backupDir);
            
            const backups = files
                .filter(f => f.startsWith('backup_') && f.endsWith('.db'))
                .map(f => {
                    const stat = fs.statSync(path.join(this.backupDir, f));
                    return {
                        file: f,
                        created: moment(stat.mtime).format('YYYY-MM-DD HH:mm:ss'),
                        size: this.formatBytes(stat.size)
                    };
                })
                .sort((a, b) => new Date(b.created) - new Date(a.created));
            
            return backups;
        } catch (err) {
            return [];
        }
    }

    static async cleanOldBackups() {
        const maxBackups = parseInt(process.env.MAX_BACKUPS) || 7;
        
        try {
            const backups = await this.list();
            
            if (backups.length > maxBackups) {
                const toDelete = backups.slice(maxBackups);
                
                for (const backup of toDelete) {
                    await fs.remove(path.join(this.backupDir, backup.file));
                    console.log(`[i] Old backup removed: ${backup.file}`);
                }
            }
        } catch (err) {
            console.error('[!] Failed to clean old backups:', err.message);
        }
    }

    static formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    static async autoBackup() {
        const interval = parseInt(process.env.BACKUP_INTERVAL_HOURS) || 24;
        
        console.log(`[i] Auto-backup scheduled every ${interval} hours`);
        
        setInterval(async () => {
            console.log('[i] Running scheduled backup...');
            await this.create();
        }, interval * 60 * 60 * 1000);
    }
}

module.exports = BackupUtil;
