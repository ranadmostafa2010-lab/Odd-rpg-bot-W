
stealing_system = """const moment = require('moment');

class StealingSystem {
    constructor(db, gameEngine) {
        this.db = db;
        this.game = gameEngine;
    }

    async attemptSteal(thief, targetPhone) {
        // Clean phone number
        const targetPhoneClean = targetPhone.replace(/[^0-9]/g, '');
        
        // Validate target
        const target = await this.db.getPlayer(targetPhoneClean);
        if (!target) {
            return { error: 'Target not found!' };
        }

        if (targetPhoneClean === thief.phone) {
            return { error: 'You cannot steal from yourself!' };
        }

        // Check cooldown
        if (thief.last_steal) {
            const minutesSince = moment().diff(moment(thief.last_steal), 'minutes');
            const cooldown = parseInt(process.env.STEAL_COOLDOWN_MINUTES) || 30;
            if (minutesSince < cooldown) {
                return {
                    error: `Steal cooldown! Wait ${cooldown - minutesSince} more minutes.`
                };
            }
        }

        // Check target has points
        if (target.points < 100) {
            return { error: 'Target is too poor to steal from!' };
        }

        // Check shield
        if (target.shield_active && moment().isBefore(moment(target.shield_expires))) {
            // Update thief cooldown anyway
            await this.db.updatePlayer(thief.phone, {
                last_steal: moment().toISOString()
            });
            
            return {
                success: false,
                caught: true,
                message: `🛡️ ${target.name} has an active protection shield! Your attempt failed.`,
                fine: 0
            };
        }

        // Calculate success
        const success = this.game.calculateStealSuccess();
        const amount = success ? this.game.calculateStealAmount(target.points) : 0;
        const fine = success ? 0 : this.game.calculateStealFine();

        // Update thief cooldown
        await this.db.updatePlayer(thief.phone, {
            last_steal: moment().toISOString()
        });

        if (success) {
            // Execute steal
            await this.db.updatePlayer(thief.phone, {
                points: thief.points + amount
            });
            await this.db.updatePlayer(target.phone, {
                points: target.points - amount
            });

            // Log the steal
            await this.db.logSteal(thief.phone, target.phone, amount, true);

            return {
                success: true,
                amount: amount,
                message: `🥷 *SUCCESS!* You stole ${amount.toLocaleString()} points from ${target.name}!`,
                targetJid: `${targetPhoneClean}@s.whatsapp.net`,
                targetMessage: `🚨 *ALERT!* ${thief.name} stole ${amount.toLocaleString()} points from you! Buy a shield in the shop for protection.`
            };
        } else {
            // Failed - pay fine
            const actualFine = Math.min(fine, thief.points);
            await this.db.updatePlayer(thief.phone, {
                points: thief.points - actualFine
            });

            // Log failed attempt
            await this.db.logSteal(thief.phone, target.phone, 0, false);

            return {
                success: false,
                caught: true,
                fine: actualFine,
                message: `🚔 *CAUGHT!* You were caught trying to steal and paid ${actualFine.toLocaleString()} points in fines!`
            };
        }
    }

    async getStealTargets(thief) {
        // Get online players with points
        const allPlayers = await this.db.getAllPlayers();
        const targets = allPlayers.filter(p => 
            p.phone !== thief.phone && 
            p.points >= 100 &&
            p.status === 'online'
        );

        // Sort by points (descending)
        targets.sort((a, b) => b.points - a.points);

        return targets.slice(0, 10); // Top 10
    }

    formatStealList(targets) {
        if (targets.length === 0) {
            return 'No valid targets found! Players must be online and have at least 100 points.';
        }

        let text = `🥷 *Potential Targets* (Online Players)\\n\\n`;
        
        targets.forEach((target, index) => {
            const shield = target.shield_active ? '🛡️' : '';
            text += `${index + 1}. ${target.name} ${shield}\\n`;
            text += `   💰 ${target.points.toLocaleString()} points\\n`;
            text += `   📱 ${target.phone}\\n\\n`;
        });

        text += `Use: /steal [phone number]\\n`;
        text += `Example: /steal 1234567890`;

        return text;
    }

    async getStealHistory(phone, limit = 10) {
        const history = await this.db.all(
            'SELECT * FROM steal_logs WHERE thief_phone = ? OR victim_phone = ? ORDER BY created_at DESC LIMIT ?',
            [phone, phone, limit]
        );

        return history;
    }

    formatStealHistory(history, playerPhone) {
        if (history.length === 0) {
            return 'No steal history found.';
        }

        let text = `📜 *Your Steal History*\\n\\n`;
        
        for (const record of history) {
            const isThief = record.thief_phone === playerPhone;
            const date = moment(record.created_at).format('MM/DD HH:mm');
            
            if (isThief) {
                if (record.success) {
                    text += `🥷 Stole ${record.amount.toLocaleString()} pts\\n`;
                } else {
                    text += `❌ Failed attempt\\n`;
                }
            } else {
                if (record.success) {
                    text += `🚨 Lost ${record.amount.toLocaleString()} pts (stolen)\\n`;
                } else {
                    text += `🛡️ Blocked steal attempt\\n`;
                }
            }
            text += `   ${date}\\n\\n`;
        }

        return text;
    }
}

module.exports = StealingSystem;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/systems/stealingSystem.js', 'w') as f:
    f.write(stealing_system)

print("✅ 12. src/systems/stealingSystem.js created")