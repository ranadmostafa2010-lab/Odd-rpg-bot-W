const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class BankSystem {
    static async handle(sock, phone, jid, args) {
        const subcommand = args[0]?.toLowerCase();
        
        switch(subcommand) {
            case 'deposit':
            case 'dep':
            case 'd':
                await this.deposit(sock, phone, jid, args[1]);
                break;
                
            case 'withdraw':
            case 'wd':
            case 'w':
                await this.withdraw(sock, phone, jid, args[1]);
                break;
                
            case 'upgrade':
            case 'up':
            case 'u':
                await this.upgrade(sock, phone, jid);
                break;
                
            case 'interest':
            case 'rate':
                await this.showInterest(sock, phone, jid);
                break;
                
            case 'history':
            case 'log':
                await this.history(sock, phone, jid);
                break;
                
            case 'transfer':
            case 'send':
                await this.transfer(sock, phone, jid, args.slice(1));
                break;
                
            default:
                await this.showBalance(sock, phone, jid);
        }
    }
    
    static async showBalance(sock, phone, jid) {
        const player = GameEngine.getPlayer(phone);
        const config = global.gameConfig;
        const tier = Helpers.getBankTier(player.bank_tier);
        const nextTier = config.bankTiers[player.bank_tier];
        
        const percent = Math.min(100, (player.bank_points / tier.maxStorage) * 100);
        const interest = Math.floor(player.bank_points * tier.interestRate);
        
        let text = `🏦 *Bank Account*\n\n`;
        text += `👤 ${player.name}\n`;
        text += `📊 Tier: ${tier.tier} ${nextTier ? `(Next: Tier ${tier.tier + 1})` : '(MAX)'}\n`;
        text += `💰 Balance: ${Helpers.formatNumber(player.bank_points)} / ${Helpers.formatNumber(tier.maxStorage)}\n`;
        text += `${Helpers.progressBar(player.bank_points, tier.maxStorage, 15)} ${percent.toFixed(1)}%\n\n`;
        
        text += `📈 Interest Rate: ${(tier.interestRate * 100).toFixed(0)}% daily\n`;
        text += `   ≈ ${Helpers.formatNumber(interest)} pts/day\n\n`;
        
        if (nextTier) {
            text += `⬆️ Upgrade Cost: ${Helpers.formatNumber(tier.upgradeCost)} points\n`;
            text += `   New Limit: ${Helpers.formatNumber(nextTier.maxStorage)}\n`;
            text += `   New Rate: ${(nextTier.interestRate * 100).toFixed(0)}%\n\n`;
        }
        
        text += `💵 Wallet: ${Helpers.formatNumber(player.points)}\n\n`;
        
        text += `*Commands:*\n`;
        text += `/bank deposit [amount] - Store points\n`;
        text += `/bank withdraw [amount] - Take points\n`;
        if (nextTier) text += `/bank upgrade - Increase tier\n`;
        text += `/bank interest - See rates`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async deposit(sock, phone, jid, amount) {
        if (!amount) {
            return sock.sendMessage(jid, { text: `Usage: /bank deposit [amount] or /bank deposit all` });
        }
        
        const player = GameEngine.getPlayer(phone);
        const config = global.gameConfig;
        const tier = Helpers.getBankTier(player.bank_tier);
        
        let depositAmount;
        if (amount.toLowerCase() === 'all') {
            depositAmount = player.points;
        } else {
            depositAmount = parseInt(amount.replace(/,/g, ''));
        }
        
        if (!depositAmount || depositAmount <= 0) {
            return sock.sendMessage(jid, { text: '❌ Invalid amount' });
        }
        
        if (player.points < depositAmount) {
            return sock.sendMessage(jid, { 
                text: `❌ Insufficient funds!\nWallet: ${Helpers.formatNumber(player.points)}\nDeposit: ${Helpers.formatNumber(depositAmount)}` 
            });
        }
        
        const availableSpace = tier.maxStorage - player.bank_points;
        if (depositAmount > availableSpace) {
            return sock.sendMessage(jid, { 
                text: `❌ Not enough storage space!\nAvailable: ${Helpers.formatNumber(availableSpace)}\nUpgrade your bank tier for more space.` 
            });
        }
        
        // Perform deposit
        GameEngine.updatePlayer(phone, {
            points: player.points - depositAmount,
            bank_points: player.bank_points + depositAmount
        });
        
        await sock.sendMessage(jid, { 
            text: `✅ Deposited ${Helpers.formatNumber(depositAmount)} points!\n\nNew Balance: ${Helpers.formatNumber(player.bank_points + depositAmount)}` 
        });
        
        GameEngine.logAction('bank_deposit', phone, { amount: depositAmount });
    }
    
    static async withdraw(sock, phone, jid, amount) {
        if (!amount) {
            return sock.sendMessage(jid, { text: `Usage: /bank withdraw [amount] or /bank withdraw all` });
        }
        
        const player = GameEngine.getPlayer(phone);
        
        let withdrawAmount;
        if (amount.toLowerCase() === 'all') {
            withdrawAmount = player.bank_points;
        } else {
            withdrawAmount = parseInt(amount.replace(/,/g, ''));
        }
        
        if (!withdrawAmount || withdrawAmount <= 0) {
            return sock.sendMessage(jid, { text: '❌ Invalid amount' });
        }
        
        if (player.bank_points < withdrawAmount) {
            return sock.sendMessage(jid, { 
                text: `❌ Insufficient bank balance!\nBank: ${Helpers.formatNumber(player.bank_points)}\nWithdraw: ${Helpers.formatNumber(withdrawAmount)}` 
            });
        }
        
        // Perform withdrawal
        GameEngine.updatePlayer(phone, {
            points: player.points + withdrawAmount,
            bank_points: player.bank_points - withdrawAmount
        });
        
        await sock.sendMessage(jid, { 
            text: `✅ Withdrew ${Helpers.formatNumber(withdrawAmount)} points!\n\nWallet: ${Helpers.formatNumber(player.points + withdrawAmount)}` 
        });
        
        GameEngine.logAction('bank_withdraw', phone, { amount: withdrawAmount });
    }
    
    static async upgrade(sock, phone, jid) {
        const player = GameEngine.getPlayer(phone);
        const config = global.gameConfig;
        const currentTier = Helpers.getBankTier(player.bank_tier);
        const nextTier = config.bankTiers[player.bank_tier];
        
        if (!nextTier) {
            return sock.sendMessage(jid, { text: '✅ Your bank is already at maximum tier (5)!' });
        }
        
        if (player.points < currentTier.upgradeCost) {
            return sock.sendMessage(jid, { 
                text: `❌ Insufficient funds!\nCost: ${Helpers.formatNumber(currentTier.upgradeCost)}\nWallet: ${Helpers.formatNumber(player.points)}` 
            });
        }
        
        // Perform upgrade
        GameEngine.updatePlayer(phone, {
            points: player.points - currentTier.upgradeCost,
            bank_tier: player.bank_tier + 1
        });
        
        await sock.sendMessage(jid, { 
            text: `🏦 *Bank Upgraded!*\n\n` +
                `Tier: ${currentTier.tier} → ${nextTier.tier}\n` +
                `Storage: ${Helpers.formatNumber(currentTier.maxStorage)} → ${Helpers.formatNumber(nextTier.maxStorage)}\n` +
                `Interest: ${(currentTier.interestRate * 100).toFixed(0)}% → ${(nextTier.interestRate * 100).toFixed(0)}%\n\n` +
                `Your points are now earning more!`
        });
        
        GameEngine.logAction('bank_upgrade', phone, { 
            from_tier: currentTier.tier, 
            to_tier: nextTier.tier,
            cost: currentTier.upgradeCost
        });
    }
    
    static async showInterest(sock, phone, jid) {
        const config = global.gameConfig;
        
        let text = `📈 *Bank Interest Rates*\n\n`;
        
        for (const tier of config.bankTiers) {
            const example = 10000;
            const daily = Math.floor(example * tier.interestRate);
            text += `Tier ${tier.tier}: ${(tier.interestRate * 100).toFixed(0)}%\n`;
            text += `   ${Helpers.formatNumber(example)} pts = ${Helpers.formatNumber(daily)} pts/day\n`;
            text += `   Max: ${Helpers.formatNumber(tier.maxStorage)}\n\n`;
        }
        
        text += `Interest is calculated daily at midnight UTC.`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async history(sock, phone, jid) {
        const db = Database.get();
        const logs = db.prepare(`
            SELECT * FROM logs 
            WHERE phone = ? AND action LIKE 'bank_%'
            ORDER BY created_at DESC
            LIMIT 10
        `).all(phone);
        
        if (logs.length === 0) {
            return sock.sendMessage(jid, { text: '📭 No bank transactions yet.' });
        }
        
        let text = `📜 *Bank History*\n\n`;
        
        for (const log of logs) {
            const details = JSON.parse(log.details || '{}');
            const date = new Date(log.created_at).toLocaleDateString();
            
            switch(log.action) {
                case 'bank_deposit':
                    text += `📥 Deposit +${Helpers.formatNumber(details.amount)} (${date})\n`;
                    break;
                case 'bank_withdraw':
                    text += `📤 Withdraw -${Helpers.formatNumber(details.amount)} (${date})\n`;
                    break;
                case 'bank_upgrade':
                    text += `⬆️ Upgrade to Tier ${details.to_tier} (${date})\n`;
                    break;
                case 'bank_interest':
                    text += `📈 Interest +${Helpers.formatNumber(details.amount)} (${date})\n`;
                    break;
            }
        }
        
        await sock.sendMessage(jid, { text });
    }
    
    static async transfer(sock, phone, jid, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const amount = parseInt(args[1]);
        
        if (!targetPhone || !amount) {
            return sock.sendMessage(jid, { text: `Usage: /bank transfer [phone] [amount]` });
        }
        
        const player = GameEngine.getPlayer(phone);
        if (player.bank_points < amount) {
            return sock.sendMessage(jid, { text: '❌ Insufficient bank balance' });
        }
        
        const target = GameEngine.getPlayer(targetPhone);
        if (!target) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        // Transfer
        GameEngine.updatePlayer(phone, { bank_points: player.bank_points - amount });
        GameEngine.updatePlayer(targetPhone, { bank_points: target.bank_points + amount });
        
        await sock.sendMessage(jid, { 
            text: `✅ Transferred ${Helpers.formatNumber(amount)} points to ${target.name}'s bank account` 
        });
        
        await sock.sendMessage(Helpers.getJid(targetPhone), {
            text: `🏦 *Bank Transfer Received*\n\nFrom: ${player.name}\nAmount: ${Helpers.formatNumber(amount)} points\n\nYour new balance: ${Helpers.formatNumber(target.bank_points + amount)}`
        });
        
        GameEngine.logAction('bank_transfer', phone, { to: targetPhone, amount });
    }
    
    static async applyDailyInterest() {
        const db = Database.get();
        const config = global.gameConfig;
        
        if (!config.features.bankInterest) return;
        
        const players = db.prepare(`
            SELECT phone, bank_points, bank_tier 
            FROM players 
            WHERE bank_points > 0
        `).all();
        
        let totalInterest = 0;
        let playerCount = 0;
        
        for (const player of players) {
            const tier = Helpers.getBankTier(player.bank_tier);
            const interest = Math.floor(player.bank_points * tier.interestRate);
            
            if (interest > 0) {
                db.prepare('UPDATE players SET bank_points = bank_points + ? WHERE phone = ?')
                    .run(interest, player.phone);
                
                totalInterest += interest;
                playerCount++;
                
                GameEngine.logAction('bank_interest', player.phone, { 
                    amount: interest, 
                    rate: tier.interestRate,
                    tier: player.bank_tier
                });
            }
        }
        
        console.log(`[Bank] Applied ${Helpers.formatNumber(totalInterest)} interest to ${playerCount} accounts`);
    }
}

module.exports = BankSystem;
