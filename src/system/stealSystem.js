const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');
const moment = require('moment');

class StealSystem {
    static async handle(sock, phone, jid, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        
        if (!targetPhone) {
            return this.showTargets(sock, phone, jid);
        }
        
        const config = global.gameConfig;
        const player = GameEngine.getPlayer(phone);
        const target = GameEngine.getPlayer(targetPhone);
        
        if (!target) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        if (targetPhone === phone) {
            return sock.sendMessage(jid, { text: '❌ You cannot steal from yourself' });
        }
        
        if (target.banned) {
            return sock.sendMessage(jid, { text: '❌ Cannot steal from banned players' });
        }
        
        // Check daily steal limit
        const today = moment().format('YYYY-MM-DD');
        const lastStealDate = player.last_steal ? moment(player.last_steal).format('YYYY-MM-DD') : null;
        
        if (lastStealDate !== today) {
            // Reset daily count
            GameEngine.updatePlayer(phone, { steals_today: 0 });
            player.steals_today = 0;
        }
        
        if (player.steals_today >= config.economy.maxStealsPerDay) {
            return sock.sendMessage(jid, { 
                text: `❌ Daily steal limit reached (${config.economy.maxStealsPerDay}/day)\nCome back tomorrow!` 
            });
        }
        
        // Check cooldown
        if (player.last_steal) {
            const minutesSince = (Date.now() - new Date(player.last_steal)) / (1000 * 60);
            if (minutesSince < config.cooldowns.steal) {
                const minsLeft = Math.ceil(config.cooldowns.steal - minutesSince);
                return sock.sendMessage(jid, { text: `⏰ Steal cooldown: ${minsLeft} minutes remaining` });
            }
        }
        
        // Check target shield
        if (target.shield_active && new Date(target.shield_expires) > new Date()) {
            const timeLeft = Helpers.formatTimeLeft(target.shield_expires);
            return sock.sendMessage(jid, { 
                text: `🛡️ ${target.name} has an active shield!\nShield expires in ${timeLeft}\n\nBuy your own shield: /shield` 
            });
        }
        
        // Check target has enough points
        const minSteal = 100;
        if (target.points < minSteal) {
            return sock.sendMessage(jid, { 
                text: `❌ ${target.name} is too poor to steal from (min: ${minSteal} pts)` 
            });
        }
        
        // Attempt steal
        const successRate = config.economy.stealSuccessRate;
        const success = Math.random() < successRate;
        
        // Update last steal time and count
        GameEngine.updatePlayer(phone, { 
            last_steal: new Date().toISOString(),
            steals_today: (player.steals_today || 0) + 1
        });
        
        if (success) {
            // Calculate steal amount (10% of target's points)
            const stealPercent = config.economy.stealAmountPercent;
            const stealAmount = Math.floor(target.points * stealPercent);
            
            // Transfer points
            GameEngine.addPoints(phone, stealAmount);
            GameEngine.addPoints(targetPhone, -stealAmount);
            
            // Log
            GameEngine.logAction('steal_success', phone, { 
                target: targetPhone, 
                amount: stealAmount 
            });
            GameEngine.logAction('steal_victim', targetPhone, { 
                thief: phone, 
                amount: stealAmount 
            });
            
            // Notify thief
            await sock.sendMessage(jid, { 
                text: `🦹 *Steal Successful!*\n\n` +
                    `You stole ${Helpers.formatNumber(stealAmount)} points from ${target.name}!\n` +
                    `Success rate: ${(successRate * 100).toFixed(0)}%\n` +
                    `Steals today: ${player.steals_today + 1}/${config.economy.maxStealsPerDay}\n\n` +
                    `💰 New balance: ${Helpers.formatNumber(player.points + stealAmount)}` 
            });
            
            // Notify victim
            await sock.sendMessage(Helpers.getJid(targetPhone), { 
                text: `🦹 *You've been robbed!*\n\n` +
                    `${player.name} stole ${Helpers.formatNumber(stealAmount)} points from you!\n\n` +
                    `🛡️ Buy a shield to prevent future thefts: /shield` 
            });
            
        } else {
            // Failed - penalty
            const penaltyPercent = config.economy.stealPenaltyPercent;
            const penalty = Math.floor(player.points * penaltyPercent);
            
            if (penalty > 0) {
                GameEngine.addPoints(phone, -penalty);
            }
            
            // Log
            GameEngine.logAction('steal_fail', phone, { 
                target: targetPhone, 
                penalty 
            });
            
            await sock.sendMessage(jid, { 
                text: `🚔 *Caught!*\n\n` +
                    `You failed to steal from ${target.name} and got caught!\n` +
                    `Penalty: ${Helpers.formatNumber(penalty)} points\n` +
                    `Success rate was ${(successRate * 100).toFixed(0)}%\n\n` +
                    `💰 New balance: ${Helpers.formatNumber(player.points - penalty)}` 
            });
            
            // Optionally notify target of failed attempt
            if (Math.random() < 0.3) { // 30% chance target is notified of attempt
                await sock.sendMessage(Helpers.getJid(targetPhone), { 
                    text: `🛡️ ${player.name} tried to steal from you but failed!` 
                });
            }
        }
    }
    
    static async showTargets(sock, phone, jid) {
        const db = Database.get();
        const player = GameEngine.getPlayer(phone);
        const config = global.gameConfig;
        
        // Find potential targets (similar level, has points, no shield)
        const targets = db.prepare(`
            SELECT phone, name, level, points, shield_active, shield_expires
            FROM players 
            WHERE phone != ? 
            AND banned = 0 
            AND points > 100
            AND level BETWEEN ? AND ?
            ORDER BY points DESC
            LIMIT 5
        `).all(phone, player.level - 5, player.level + 5);
        
        if (targets.length === 0) {
            return sock.sendMessage(jid, { 
                text: `🎯 No targets found.\n\nTargets must be within 5 levels and have over 100 points.` 
            });
        }
        
        let text = `🎯 *Steal Targets*\n\n`;
        text += `Your level: ${player.level}\n`;
        text += `Success rate: ${(config.economy.stealSuccessRate * 100).toFixed(0)}%\n`;
        text += `Cooldown: ${config.cooldowns.steal} minutes\n`;
        text += `Daily limit: ${config.economy.maxStealsPerDay}/day\n\n`;
        
        targets.forEach((t, i) => {
            const shielded = t.shield_active && new Date(t.shield_expires) > new Date();
            const worth = Math.floor(t.points * config.economy.stealAmountPercent);
            
            text += `${i + 1}. *${t.name}* (Lv.${t.level})\n`;
            text += `   💰 ${Helpers.formatNumber(t.points)} pts`;
            if (shielded) {
                const expires = Helpers.formatTimeLeft(t.shield_expires);
                text += ` 🛡️ [${expires}]`;
            } else {
                text += ` 🎯 Steal: ~${Helpers.formatNumber(worth)}`;
            }
            text += `\n`;
            text += `   Command: /steal ${t.phone}\n\n`;
        });
        
        text += `🛡️ Protect yourself: /shield`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async buyShield(sock, phone, jid) {
        const config = global.gameConfig;
        const player = GameEngine.getPlayer(phone);
        const cost = config.economy.shieldCost;
        const duration = config.economy.shieldDuration;
        
        if (player.points < cost) {
            return sock.sendMessage(jid, { 
                text: `❌ Insufficient funds!\nCost: ${Helpers.formatNumber(cost)}\nWallet: ${Helpers.formatNumber(player.points)}` 
            });
        }
        
        // Check if already has shield
        if (player.shield_active && new Date(player.shield_expires) > new Date()) {
            const timeLeft = Helpers.formatTimeLeft(player.shield_expires);
            return sock.sendMessage(jid, { 
                text: `🛡️ You already have an active shield!\nTime remaining: ${timeLeft}\n\nWait for it to expire before buying a new one.` 
            });
        }
        
        // Purchase shield
        GameEngine.addPoints(phone, -cost);
        const expires = moment().add(duration, 'hours').toISOString();
        
        GameEngine.updatePlayer(phone, {
            shield_active: 1,
            shield_expires: expires
        });
        
        await sock.sendMessage(jid, { 
            text: `🛡️ *Shield Activated!*\n\n` +
                `Duration: ${duration} hours\n` +
                `Cost: ${Helpers.formatNumber(cost)} points\n` +
                `Expires: ${moment(expires).format('MMM DD, HH:mm')}\n\n` +
                `You are now protected from stealing attempts!` 
        });
        
        GameEngine.logAction('shield_purchased', phone, { cost, duration });
    }
}

module.exports = StealSystem;
