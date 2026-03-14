const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');
const ConfigLoader = require('../core/configLoader');

class AdminSystem {
    static async handle(sock, phone, jid, args) {
        if (!GameEngine.isAdmin(phone)) {
            return sock.sendMessage(jid, { text: '⛔ Admin access required' });
        }
        
        const subcommand = args[0]?.toLowerCase();
        
        switch(subcommand) {
            case 'help':
            case 'commands':
                await this.showHelp(sock, jid);
                break;
                
            case 'givepoints':
            case 'addpoints':
                await this.givePoints(sock, phone, args.slice(1));
                break;
                
            case 'removepoints':
            case 'takepoints':
                await this.removePoints(sock, phone, args.slice(1));
                break;
                
            case 'setlevel':
                await this.setLevel(sock, phone, args.slice(1));
                break;
                
            case 'setexp':
                await this.setExp(sock, phone, args.slice(1));
                break;
                
            case 'ban':
                await this.ban(sock, phone, args.slice(1));
                break;
                
            case 'unban':
                await this.unban(sock, phone, args.slice(1));
                break;
                
            case 'mute':
                await this.mute(sock, phone, args.slice(1));
                break;
                
            case 'unmute':
                await this.unmute(sock, phone, args.slice(1));
                break;
                
            case 'spawnboss':
            case 'summon':
                await this.spawnBoss(sock, phone, args.slice(1));
                break;
                
            case 'killboss':
                await this.killBoss(sock, phone, args.slice(1));
                break;
                
            case 'maintenance':
            case 'maint':
                await this.maintenance(sock, phone, args.slice(1));
                break;
                
            case 'reload':
                await this.reloadConfig(sock, phone, jid);
                break;
                
            case 'backup':
                await this.backup(sock, phone, jid);
                break;
                
            case 'restore':
                await this.restore(sock, phone, args.slice(1));
                break;
                
            case 'stats':
            case 'info':
                await this.stats(sock, phone, jid);
                break;
                
            case 'playerinfo':
            case 'pi':
                await this.playerInfo(sock, phone, jid, args[1]);
                break;
                
            case 'broadcast':
            case 'bc':
                await this.broadcast(sock, phone, args.slice(1).join(' '));
                break;
                
            case 'eval':
                await this.eval(sock, phone, jid, args.slice(1));
                break;
                
            case 'sql':
                await this.sql(sock, phone, jid, args.slice(1));
                break;
                
            case 'announce':
                await this.announce(sock, phone, args.slice(1).join(' '));
                break;
                
            case 'cleardb':
                await this.clearDatabase(sock, phone, jid);
                break;
                
            case 'restart':
                await this.restart(sock, phone, jid);
                break;
                
            default:
                await this.showHelp(sock, jid);
        }
    }
    
    static async showHelp(sock, jid) {
        const prefix = process.env.BOT_PREFIX || '/';
        
        const text = `🔧 *Admin Commands*\n\n` +
            `${prefix}admin givepoints [phone] [amount]\n` +
            `${prefix}admin removepoints [phone] [amount]\n` +
            `${prefix}admin setlevel [phone] [level]\n` +
            `${prefix}admin setexp [phone] [exp]\n` +
            `${prefix}admin ban [phone] [reason] [hours]\n` +
            `${prefix}admin unban [phone]\n` +
            `${prefix}admin mute [phone] [minutes]\n` +
            `${prefix}admin unmute [phone]\n` +
            `${prefix}admin spawnboss [name]\n` +
            `${prefix}admin killboss [boss_id]\n` +
            `${prefix}admin maintenance [on/off]\n` +
            `${prefix}admin reload - Reload config\n` +
            `${prefix}admin backup - Backup database\n` +
            `${prefix}admin stats - Bot statistics\n` +
            `${prefix}admin playerinfo [phone]\n` +
            `${prefix}admin broadcast [message]\n` +
            `${prefix}admin eval [code] - Execute JS\n` +
            `${prefix}admin sql [query] - Run SQL`;
            
        await sock.sendMessage(jid, { text });
    }
    
    static async givePoints(sock, adminPhone, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const amount = parseInt(args[1]);
        
        if (!targetPhone || !amount) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin givepoints [phone] [amount]' 
            });
        }
        
        const target = GameEngine.getPlayer(targetPhone);
        if (!target) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { text: '❌ Player not found' });
        }
        
        GameEngine.addPoints(targetPhone, amount);
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `✅ Gave ${Helpers.formatNumber(amount)} points to ${target.name} (${targetPhone})` 
        });
        
        await sock.sendMessage(Helpers.getJid(targetPhone), { 
            text: `🎁 *Admin Gift!*\n\nYou received ${Helpers.formatNumber(amount)} points from admin!\nNew balance: ${Helpers.formatNumber(target.points + amount)}` 
        });
        
        GameEngine.logAction('admin_give', adminPhone, { target: targetPhone, amount });
    }
    
    static async removePoints(sock, adminPhone, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const amount = parseInt(args[1]);
        
        if (!targetPhone || !amount) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin removepoints [phone] [amount]' 
            });
        }
        
        const target = GameEngine.getPlayer(targetPhone);
        if (!target) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { text: '❌ Player not found' });
        }
        
        const removeAmount = Math.min(amount, target.points);
        GameEngine.addPoints(targetPhone, -removeAmount);
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `✅ Removed ${Helpers.formatNumber(removeAmount)} points from ${target.name}` 
        });
        
        await sock.sendMessage(Helpers.getJid(targetPhone), { 
            text: `⚠️ Admin removed ${Helpers.formatNumber(removeAmount)} points from your account.` 
        });
        
        GameEngine.logAction('admin_remove', adminPhone, { target: targetPhone, amount: removeAmount });
    }
    
    static async setLevel(sock, adminPhone, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const level = parseInt(args[1]);
        
        if (!targetPhone || !level || level < 1) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin setlevel [phone] [level]' 
            });
        }
        
        const target = GameEngine.getPlayer(targetPhone);
        if (!target) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { text: '❌ Player not found' });
        }
        
        const config = global.gameConfig;
        const newExp = Helpers.getTotalExpForLevel(level);
        
        GameEngine.updatePlayer(targetPhone, {
            level: level,
            exp: newExp,
            max_hp: 100 + ((level - 1) * config.leveling.hpPerLevel),
            attack: 10 + ((level - 1) * config.leveling.attackPerLevel),
            defense: 5 + ((level - 1) * config.leveling.defensePerLevel),
            speed: 5 + ((level - 1) * config.leveling.speedPerLevel),
            hp: 100 + ((level - 1) * config.leveling.hpPerLevel)
        });
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `✅ Set ${target.name}'s level to ${level}` 
        });
        
        await sock.sendMessage(Helpers.getJid(targetPhone), { 
            text: `🆙 Admin set your level to ${level}!` 
        });
    }
    
    static async setExp(sock, adminPhone, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const exp = parseInt(args[1]);
        
        if (!targetPhone || exp === undefined) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin setexp [phone] [exp]' 
            });
        }
        
        const target = GameEngine.getPlayer(targetPhone);
        if (!target) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { text: '❌ Player not found' });
        }
        
        const newLevel = Helpers.calculateLevel(exp);
        
        GameEngine.updatePlayer(targetPhone, {
            exp: exp,
            level: newLevel
        });
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `✅ Set ${target.name}'s EXP to ${Helpers.formatNumber(exp)} (Level ${newLevel})` 
        });
    }
    
    static async ban(sock, adminPhone, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const reason = args[1] || 'No reason provided';
        const duration = parseInt(args[2]); // hours, optional
        
        if (!targetPhone) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin ban [phone] [reason] [hours(optional)]' 
            });
        }
        
        const target = GameEngine.getPlayer(targetPhone);
        
        GameEngine.banPlayer(targetPhone, reason, duration);
        
        let text = `🚫 Banned ${target?.name || targetPhone}\nReason: ${reason}`;
        if (duration) {
            text += `\nDuration: ${duration} hours`;
        } else {
            text += `\nDuration: Permanent`;
        }
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { text });
        
        if (target) {
            await sock.sendMessage(Helpers.getJid(targetPhone), { 
                text: `🚫 *ACCOUNT BANNED*\n\nReason: ${reason}\n${duration ? `Duration: ${duration} hours` : 'Duration: Permanent'}\n\nContact admin if you believe this is a mistake.` 
            });
        }
    }
    
    static async unban(sock, adminPhone, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        
        if (!targetPhone) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin unban [phone]' 
            });
        }
        
        GameEngine.unbanPlayer(targetPhone);
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `✅ Unbanned ${targetPhone}` 
        });
        
        await sock.sendMessage(Helpers.getJid(targetPhone), { 
            text: `✅ Your account has been unbanned. Welcome back!` 
        });
    }
    
    static async mute(sock, adminPhone, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const minutes = parseInt(args[1]) || 60;
        
        if (!targetPhone) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin mute [phone] [minutes]' 
            });
        }
        
        const expires = new Date(Date.now() + minutes * 60000).toISOString();
        
        // Add mute to active_effects
        const target = GameEngine.getPlayer(targetPhone);
        const effects = JSON.parse(target.active_effects || '{}');
        effects.muted = { until: expires };
        
        GameEngine.updatePlayer(targetPhone, { active_effects: JSON.stringify(effects) });
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `🔇 Muted ${target?.name || targetPhone} for ${minutes} minutes` 
        });
    }
    
    static async unmute(sock, adminPhone, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        
        if (!targetPhone) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin unmute [phone]' 
            });
        }
        
        const target = GameEngine.getPlayer(targetPhone);
        const effects = JSON.parse(target.active_effects || '{}');
        delete effects.muted;
        
        GameEngine.updatePlayer(targetPhone, { active_effects: JSON.stringify(effects) });
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `🔊 Unmuted ${target?.name || targetPhone}` 
        });
    }
    
    static async spawnBoss(sock, adminPhone, args) {
        const bossName = args.join(' ');
        await WorldBossSystem.spawn(sock, bossName);
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `🐉 Boss ${bossName || 'Random'} spawned!` 
        });
    }
    
    static async killBoss(sock, adminPhone, args) {
        const bossId = args[0];
        await WorldBossSystem.forceEnd(sock, bossId);
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `💀 Boss ${bossId} terminated` 
        });
    }
    
    static async maintenance(sock, adminPhone, args) {
        const mode = args[0]?.toLowerCase();
        
        if (mode === 'on' || mode === 'true' || mode === '1') {
            process.env.MAINTENANCE_MODE = 'true';
            await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: `🔧 Maintenance mode ENABLED` 
            });
        } else {
            process.env.MAINTENANCE_MODE = 'false';
            await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: `✅ Maintenance mode DISABLED` 
            });
        }
    }
    
    static async reloadConfig(sock, adminPhone, jid) {
        ConfigLoader.reload();
        await sock.sendMessage(jid, { text: `🔄 Configuration reloaded!` });
    }
    
    static async backup(sock, adminPhone, jid) {
        GameEngine.backupDatabase();
        await sock.sendMessage(jid, { text: `💾 Database backup initiated` });
    }
    
    static async restore(sock, adminPhone, args) {
        // Implementation for database restore
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: 'Restore functionality - contact developer' 
        });
    }
    
    static async stats(sock, adminPhone, jid) {
        const stats = GameEngine.getStats();
        
        const uptime = Date.now() - global.botStartTime;
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        
        let text = `📊 *Bot Statistics*\n\n`;
        text += `⏱️ Uptime: ${hours} hours\n`;
        text += `👥 Total Players: ${Helpers.formatNumber(stats.totalPlayers)}\n`;
        text += `🟢 Active Today: ${Helpers.formatNumber(stats.activeToday)}\n`;
        text += `⚔️ Total Battles: ${Helpers.formatNumber(stats.totalBattles)}\n`;
        text += `🐾 Total Pets: ${Helpers.formatNumber(stats.totalPets)}\n`;
        text += `💰 Points in Economy: ${Helpers.formatNumber(stats.totalPoints)}\n`;
        text += `🔄 Total Trades: ${Helpers.formatNumber(stats.totalTrades)}`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async playerInfo(sock, adminPhone, jid, targetPhone) {
        if (!targetPhone) {
            return sock.sendMessage(jid, { text: 'Usage: /admin playerinfo [phone]' });
        }
        
        const cleanPhone = targetPhone.replace(/[^0-9]/g, '');
        const target = GameEngine.getPlayer(cleanPhone);
        
        if (!target) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        const pets = GameEngine.getPlayerPets(cleanPhone);
        const inventory = GameEngine.getInventory(cleanPhone);
        
        let text = `🔍 *Player Info: ${target.name}*\n\n`;
        text += `📱 Phone: ${cleanPhone}\n`;
        text += `📊 Level: ${target.level} | EXP: ${target.exp}\n`;
        text += `💰 Points: ${Helpers.formatNumber(target.points)}\n`;
        text += `🏦 Bank: ${Helpers.formatNumber(target.bank_points)}\n`;
        text += `🏆 Rank: ${target.rank} (${target.elo} ELO)\n`;
        text += `⚔️ PvP: ${target.wins}W/${target.losses}L\n`;
        text += `🐾 Pets: ${pets.length}\n`;
        text += `📦 Items: ${inventory.length}\n`;
        text += `🛡️ Shield: ${target.shield_active ? 'Active' : 'Inactive'}\n`;
        text += `⛔ Banned: ${target.banned ? 'YES' : 'No'}\n`;
        text += `📅 Created: ${new Date(target.created_at).toLocaleDateString()}\n`;
        text += `🕐 Last Active: ${new Date(target.last_active).toLocaleString()}`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async broadcast(sock, adminPhone, message) {
        if (!message) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin broadcast [message]' 
            });
        }
        
        const db = Database.get();
        const players = db.prepare('SELECT phone FROM players WHERE banned = 0').all();
        
        let sent = 0;
        let failed = 0;
        
        for (const player of players) {
            try {
                await sock.sendMessage(Helpers.getJid(player.phone), { 
                    text: `📢 *Broadcast*\n\n${message}\n\n- Admin` 
                });
                sent++;
                await Helpers.sleep(100); // Rate limiting
            } catch (e) {
                failed++;
            }
        }
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `📢 Broadcast sent!\n✅ ${sent} delivered\n❌ ${failed} failed` 
        });
    }
    
    static async eval(sock, adminPhone, jid, args) {
        const code = args.join(' ');
        
        if (!code) {
            return sock.sendMessage(jid, { text: 'Usage: /admin eval [code]' });
        }
        
        try {
            // WARNING: This is dangerous! Only for trusted admins.
            const result = eval(code);
            await sock.sendMessage(jid, { 
                text: `✅ Result:\n${JSON.stringify(result, null, 2).substring(0, 4000)}` 
            });
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` });
        }
    }
    
    static async sql(sock, adminPhone, jid, args) {
        const query = args.join(' ');
        
        if (!query) {
            return sock.sendMessage(jid, { text: 'Usage: /admin sql [query]' });
        }
        
        try {
            const db = Database.get();
            const result = db.prepare(query).all();
            await sock.sendMessage(jid, { 
                text: `✅ Query executed:\n${JSON.stringify(result, null, 2).substring(0, 4000)}` 
            });
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` });
        }
    }
    
    static async announce(sock, adminPhone, message) {
        // Announce to all online players
        if (!message) {
            return sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
                text: 'Usage: /admin announce [message]' 
            });
        }
        
        const db = Database.get();
        const online = db.prepare(`
            SELECT phone FROM players 
            WHERE last_active > datetime('now', '-5 minutes')
            AND banned = 0
        `).all();
        
        for (const player of online) {
            await sock.sendMessage(Helpers.getJid(player.phone), { 
                text: `📢 *Announcement*\n\n${message}` 
            });
        }
        
        await sock.sendMessage(adminPhone + '@s.whatsapp.net', { 
            text: `📢 Announced to ${online.length} online players` 
        });
    }
    
    static async clearDatabase(sock, adminPhone, jid) {
        // DANGEROUS: Clear all data
        await sock.sendMessage(jid, { 
            text: '⚠️ This will delete ALL data. Use /admin cleardb confirm to proceed.' 
        });
    }
    
    static async restart(sock, adminPhone, jid) {
        await sock.sendMessage(jid, { text: '🔄 Restarting bot...' });
        process.exit(0);
    }
}

module.exports = AdminSystem;
