
bank_system = """const moment = require('moment');
const chalk = require('chalk');

class BankSystem {
    constructor(db, gameEngine) {
        this.db = db;
        this.game = gameEngine;
    }

    async getBankInfo(player) {
        const tierInfo = this.game.getBankTierInfo(player.bank_tier);
        const interest = this.game.calculateInterest(player.bank_balance, player.bank_tier);
        
        return {
            tier: tierInfo,
            balance: player.bank_balance,
            maxBalance: tierInfo.max_balance,
            interestRate: tierInfo.interest,
            dailyInterest: interest,
            wallet: player.points
        };
    }

    async deposit(player, amount) {
        amount = parseInt(amount);
        
        if (isNaN(amount) || amount <= 0) {
            return { error: 'Invalid amount!' };
        }

        if (player.points < amount) {
            return { error: `Insufficient funds! You have ${player.points.toLocaleString()} points.` };
        }

        const tierInfo = this.game.getBankTierInfo(player.bank_tier);
        
        if (player.bank_balance + amount > tierInfo.max_balance) {
            return {
                error: `Deposit would exceed your ${tierInfo.name} tier limit of ${tierInfo.max_balance.toLocaleString()} points! Upgrade your bank tier.`
            };
        }

        // Execute deposit
        await this.db.updatePlayer(player.phone, {
            points: player.points - amount,
            bank_balance: player.bank_balance + amount
        });

        return {
            success: true,
            deposited: amount,
            newBalance: player.bank_balance + amount,
            wallet: player.points - amount,
            message: `✅ Deposited ${amount.toLocaleString()} points!\\n🏦 Bank: ${(player.bank_balance + amount).toLocaleString()} points`
        };
    }

    async withdraw(player, amount) {
        amount = parseInt(amount);
        
        if (isNaN(amount) || amount <= 0) {
            return { error: 'Invalid amount!' };
        }

        if (player.bank_balance < amount) {
            return { error: `Insufficient bank balance! You have ${player.bank_balance.toLocaleString()} points.` };
        }

        // Execute withdrawal
        await this.db.updatePlayer(player.phone, {
            points: player.points + amount,
            bank_balance: player.bank_balance - amount
        });

        return {
            success: true,
            withdrawn: amount,
            newBalance: player.bank_balance - amount,
            wallet: player.points + amount,
            message: `✅ Withdrew ${amount.toLocaleString()} points!\\n💰 Wallet: ${(player.points + amount).toLocaleString()} points`
        };
    }

    async upgradeTier(player) {
        const currentTier = this.game.getBankTierInfo(player.bank_tier);
        
        if (!currentTier.upgrade_cost) {
            return { error: 'You already have the highest tier (Diamond)!' };
        }

        if (player.points < currentTier.upgrade_cost) {
            return {
                error: `Need ${currentTier.upgrade_cost.toLocaleString()} points to upgrade! You have ${player.points.toLocaleString()}.`
            };
        }

        const tiers = ['basic', 'silver', 'gold', 'diamond'];
        const nextTier = tiers[tiers.indexOf(player.bank_tier) + 1];
        const nextTierInfo = this.game.getBankTierInfo(nextTier);

        // Execute upgrade
        await this.db.updatePlayer(player.phone, {
            points: player.points - currentTier.upgrade_cost,
            bank_tier: nextTier
        });

        return {
            success: true,
            newTier: nextTierInfo,
            cost: currentTier.upgrade_cost,
            message: `🏦 Upgraded to *${nextTierInfo.name}* tier!\\n📊 Interest rate: ${(nextTierInfo.interest * 100).toFixed(0)}%\\n💎 Max balance: ${nextTierInfo.max_balance.toLocaleString()}`
        };
    }

    async processDailyInterest() {
        try {
            const players = await this.db.getAllPlayers();
            let totalInterestPaid = 0;
            let playersPaid = 0;

            for (const player of players) {
                if (player.bank_balance > 0) {
                    const interest = this.game.calculateInterest(player.bank_balance, player.bank_tier);
                    
                    if (interest > 0) {
                        await this.db.updatePlayer(player.phone, {
                            bank_balance: player.bank_balance + interest
                        });
                        
                        totalInterestPaid += interest;
                        playersPaid++;

                        // Log it
                        await this.db.logAction(player.phone, 'bank_interest', `Received ${interest} points`);
                    }
                }
            }

            console.log(chalk.green(`🏦 Daily interest processed: ${totalInterestPaid.toLocaleString()} points paid to ${playersPaid} players`));
            
            return {
                totalInterest: totalInterestPaid,
                playersPaid: playersPaid
            };
        } catch (error) {
            console.error(chalk.red('Error processing daily interest:'), error);
            return { error: error.message };
        }
    }

    formatBankInfo(info, player) {
        let text = `🏦 *Bank Account*\\n\\n`;
        text += `Tier: ${info.tier.emoji} ${info.tier.name}\\n`;
        text += `💰 Wallet: ${info.wallet.toLocaleString()} points\\n`;
        text += `🏦 Balance: ${info.balance.toLocaleString()} points\\n`;
        text += `📊 Interest Rate: ${(info.interestRate * 100).toFixed(0)}% daily\\n`;
        text += `💵 Daily Interest: ~${info.dailyInterest.toLocaleString()} points\\n`;
        text += `💎 Max Balance: ${info.maxBalance.toLocaleString()} points\\n\\n`;

        if (info.tier.upgrade_cost) {
            const nextTier = this.getNextTier(info.tier);
            text += `⬆️ Upgrade to ${nextTier.name}: ${info.tier.upgrade_cost.toLocaleString()} points\\n\\n`;
        }

        text += `*Commands:*\\n`;
        text += `/bank deposit [amount]\\n`;
        text += `/bank withdraw [amount]\\n`;
        text += `/bank upgrade`;

        return text;
    }

    getNextTier(currentTier) {
        const tiers = [
            { name: 'Silver', interest: 0.03 },
            { name: 'Gold', interest: 0.05 },
            { name: 'Diamond', interest: 0.08 }
        ];
        
        if (currentTier.name === 'Basic') return tiers[0];
        if (currentTier.name === 'Silver') return tiers[1];
        if (currentTier.name === 'Gold') return tiers[2];
        return null;
    }
}

module.exports = BankSystem;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/systems/bankSystem.js', 'w') as f:
    f.write(bank_system)

print("✅ 13. src/systems/bankSystem.js created")