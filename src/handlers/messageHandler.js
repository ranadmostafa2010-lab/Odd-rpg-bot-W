
message_handler = """const chalk = require('chalk');
const moment = require('moment');

class MessageHandler {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.db;
        this.game = bot.gameEngine;
        this.battleManager = bot.battleManager;
        this.pve = bot.pveSystem;
        this.pvp = bot.pvpSystem;
        this.group = bot.groupBattleSystem;
        this.trading = bot.tradingSystem;
        this.stealing = bot.stealingSystem;
        this.bank = bot.bankSystem;
        this.boss = bot.bossSystem;
        
        this.prefix = process.env.PREFIX || '/';
        this.activeMessages = new Map(); // For message editing
    }

    async handleMessage(msg, sock) {
        try {
            const phone = msg.key.remoteJid.replace(/@s.whatsapp.net|@g.us/g, '');
            const isGroup = msg.key.remoteJid.endsWith('@g.us');
            const text = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || 
                        msg.message?.buttonsResponseMessage?.selectedButtonId || '';
            
            if (!text.startsWith(this.prefix)) return;
            
            const args = text.slice(this.prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const jid = msg.key.remoteJid;
            
            // Check maintenance mode
            if (process.env.MAINTENANCE_MODE === 'true' && phone !== process.env.ADMIN_NUMBER) {
                return await this.sendMessage(jid, '🔧 Bot is under maintenance. Please try again later.');
            }
            
            // Get or create player
            let player = await this.db.getPlayer(phone);
            if (!player && command !== 'start') {
                return await this.sendStartMessage(jid);
            }
            
            if (command === 'start') {
                if (!player) {
                    player = await this.db.createPlayer(phone, msg.pushName || 'Player');
                    await this.db.addPet(phone, { name: "Starter Puppy", rarity: "common", atk: 5, emoji: "🐕" });
                    await this.sendMessage(jid, 
                        `🎮 *Welcome to ODD RPG!*\\n\\n` +
                        `You received:\\n` +
                        `💰 5,000 starter points\\n` +
                        `🐕 Starter Puppy pet\\n` +
                        `📦 Daily rewards available\\n\\n` +
                        `Use ${this.prefix}menu to see all commands!`
                    );
                } else {
                    await this.sendMessage(jid, '👋 You already have an account! Use ' + this.prefix + 'menu');
                }
                return;
            }
            
            // Check if banned
            if (player.banned) {
                return await this.sendMessage(jid, `🚫 You are banned!\\nReason: ${player.ban_reason || 'No reason provided'}`);
            }

            // Update online status
            await this.db.updateStatus(phone, 'online');
            
            // Log command
            await this.db.logAction(phone, 'command', `${command} ${args.join(' ')}`);
            
            // Route command
            await this.routeCommand(command, args, msg, player, isGroup);
            
        } catch (error) {
            console.error(chalk.red('Error handling message:'), error);
            await this.sendMessage(msg.key.remoteJid, '❌ An error occurred. Please try again.');
        }
    }

    async routeCommand(command, args, msg, player, isGroup) {
        const jid = msg.key.remoteJid;
        
        // Basic Commands
        switch(command) {
            case 'menu':
                await this.sendMenu(jid, player);
                break;
            case 'stats':
                await this.sendStats(jid, player);
                break;
            case 'tutorial':
            case 'help':
                await this.sendTutorial(jid, args);
                break;
            case 'code':
                await this.redeemCode(jid, player, args);
                break;
            case 'daily':
                await this.claimDaily(jid, player);
                break;
            case 'online':
                await this.showOnlinePlayers(jid);
                break;
            case 'leaderboard':
            case 'lb':
                await this.showLeaderboard(jid, args);
                break;
            case 'update':
                await this.sendUpdateNotes(jid);
                break;

            // PvE Battle Commands
            case 'battle':
            case 'odd':
                await this.startPvE(jid, player);
                break;
            case 'attack':
            case 'defend':
            case 'heal':
            case 'flee':
            case 'special':
                await this.handleBattleAction(jid, player, command);
                break;

            // PvP Commands
            case 'ranked':
            case 'pvp':
                await this.findPvP(jid, player);
                break;
            case 'pvpcancel':
                await this.cancelPvP(jid, player);
                break;
            case 'rank':
                await this.showRank(jid, player);
                break;

            // Group Battle Commands (Group only)
            case 'groupbattle':
            case 'gb':
                if (!isGroup) return await this.sendMessage(jid, '❌ Group battles can only be started in groups!');
                await this.startGroupBattle(jid, player, args);
                break;
            case 'joingroup':
            case 'join':
                if (!isGroup) return await this.sendMessage(jid, '❌ This command only works in groups!');
                await this.joinGroupBattle(jid, player);
                break;
            case 'gattack':
            case 'gspecial':
            case 'gheal':
            case 'gstatus':
                if (!isGroup) return await this.sendMessage(jid, '❌ This command only works in groups!');
                await this.handleGroupAction(jid, player, command);
                break;

            // Trading Commands
            case 'trade':
                await this.initiateTrade(jid, player, args);
                break;
            case 'accept':
                await this.acceptTrade(jid, player, args);
                break;
            case 'decline':
                await this.declineTrade(jid, player, args);
                break;
            case 'trades':
                await this.showPendingTrades(jid, player);
                break;

            // Stealing Commands
            case 'steal':
                await this.attemptSteal(jid, player, args);
                break;
            case 'targets':
                await this.showStealTargets(jid);
                break;

            // Economy Commands
            case 'bank':
                await this.handleBank(jid, player, args);
                break;
            case 'shop':
                await this.showShop(jid, player);
                break;
            case 'buy':
                await this.buyItem(jid, player, args);
                break;
            case 'crates':
                await this.handleCrates(jid, player, args);
                break;
            case 'pets':
                await this.showPets(jid, player);
                break;
            case 'equip':
                await this.equipPet(jid, player, args);
                break;
            case 'heal':
                await this.healPlayer(jid, player);
                break;

            // Boss Commands
            case 'boss':
                await this.handleBoss(jid, player, args);
                break;

            // Admin Commands
            default:
                if (command.startsWith('admin')) {
                    await this.handleAdminCommand(command, args, jid, player);
                } else {
                    await this.sendMessage(jid, `❓ Unknown command. Use ${this.prefix}menu to see available commands.`);
                }
        }
    }

    // ==================== BASIC COMMANDS ====================

    async sendStartMessage(jid) {
        const text = `👋 *Welcome to ODD RPG Bot!*\\n\\n` +
            `🎮 To start playing, send:\\n` +
            `${this.prefix}start\\n\\n` +
            `You'll get:\\n` +
            `💰 5,000 starter points\\n` +
            `🐕 Free pet\\n` +
            `📦 Daily rewards\\n` +
            `⚔️ Epic battles\\n` +
            `👥 Group raids\\n` +
            `🏆 PvP ranked\\n\\n` +
            `_The ultimate WhatsApp RPG experience!_`;
        await this.sendMessage(jid, text);
    }

    async sendMenu(jid, player) {
        const equipped = await this.db.getEquippedPet(player.phone);
        const petInfo = equipped ? `${equipped.name} (+${equipped.atk} ATK)` : 'None';
        
        const text = `🎮 *${process.env.BOT_NAME || 'ODD RPG'}*\\n\\n` +
            `👤 *${player.name}* | Level ${player.level} | ${player.rank_tier.toUpperCase()}\\n` +
            `❤️ HP: ${player.hp}/${player.max_hp} | ⚔️ Power: ${player.power}\\n` +
            `💰 Points: ${player.points.toLocaleString()} | 🏦 Bank: ${player.bank_balance.toLocaleString()}\\n` +
            `🐾 Pet: ${petInfo}\\n` +
            `⚔️ PvP: ${player.pvp_wins}W/${player.pvp_losses}L | ELO: ${player.elo_rating}\\n\\n` +
            `*Quick Actions:*\\n` +
            `${this.prefix}battle - Start PvE battle\\n` +
            `${this.prefix}ranked - Find PvP match\\n` +
            `${this.prefix}daily - Claim reward\\n` +
            `${this.prefix}bank - Bank menu\\n` +
            `${this.prefix}shop - Buy items\\n` +
            `${this.prefix}crates - Open crates\\n` +
            `${this.prefix}trade [phone] - Trade\\n` +
            `${this.prefix}steal [phone] - Steal\\n` +
            `${this.prefix}boss - World boss\\n` +
            `${this.prefix}groupbattle - Group raid (groups)\\n` +
            `${this.prefix}tutorial - How to play`;
        
        await this.sendMessage(jid, text);
    }

    async sendStats(jid, player) {
        const pets = await this.db.getPets(player.phone);
        const totalBattles = player.wins + player.losses;
        const totalPvP = player.pvp_wins + player.pvp_losses;
        const winRate = totalBattles > 0 ? Math.round((player.wins / totalBattles) * 100) : 0;
        const pvpWinRate = totalPvP > 0 ? Math.round((player.pvp_wins / totalPvP) * 100) : 0;
        const rankInfo = this.game.getRankTier(player.elo_rating);
        
        const text = `📊 *${player.name}'s Statistics*\\n\\n` +
            `📈 Level: ${player.level} | EXP: ${player.exp}/${player.level * 100}\\n` +
            `❤️ HP: ${player.max_hp} | ⚔️ Power: ${player.power}\\n` +
            `💰 Wallet: ${player.points.toLocaleString()}\\n` +
            `🏦 Bank: ${player.bank_balance.toLocaleString()} (${player.bank_tier})\\n\\n` +
            `⚔️ PvE: ${player.wins}W/${player.losses}L (${winRate}% win rate)\\n` +
            `🏆 PvP: ${player.pvp_wins}W/${player.pvp_losses}L (${pvpWinRate}% win rate)\\n` +
            `🎖️ Rank: ${rankInfo.emoji} ${rankInfo.tier.toUpperCase()} (${player.elo_rating} ELO)\\n` +
            `🐾 Pets: ${pets.length} collected\\n` +
            `🛡️ Shield: ${player.shield_active ? 'Active ✅' : 'None ❌'}\\n` +
            `📅 Joined: ${moment(player.created_at).format('MMM DD, YYYY')}`;
        
        await this.sendMessage(jid, text);
    }

    async sendTutorial(jid, args) {
        const page = parseInt(args[0]) || 1;
        const tutorial = this.game.getTutorialPage(page);
        
        if (!tutorial) {
            return await this.sendMessage(jid, '❌ Invalid tutorial page! Use 1-8');
        }

        const totalPages = this.game.getTotalTutorialPages();
        let text = `📚 *${tutorial.title}* (${page}/${totalPages})\\n\\n${tutorial.content}\\n\\n`;
        
        if (page < totalPages) {
            text += `Next: ${this.prefix}tutorial ${page + 1}`;
        }
        
        await this.sendMessage(jid, text);
    }

    async redeemCode(jid, player, args) {
        if (args.length === 0) {
            return await this.sendMessage(jid, `Usage: ${this.prefix}code [CODE]`);
        }

        const code = args[0].toUpperCase();
        const validation = this.game.validatePromoCode(code);

        if (!validation.valid) {
            return await this.sendMessage(jid, `❌ ${validation.reason}`);
        }

        const used = await this.db.hasUsedCode(player.phone, code);
        if (used) {
            return await this.sendMessage(jid, '❌ You already used this code!');
        }

        const codeData = validation.data;
        let text = `🎁 *Code Redeemed!*\\n\\n`;
        
        if (codeData.points) {
            await this.db.updatePlayer(player.phone, {
                points: player.points + codeData.points
            });
            text += `💰 +${codeData.points.toLocaleString()} points\\n`;
        }
        
        if (codeData.pet) {
            await this.db.addPet(player.phone, codeData.pet);
            text += `🐾 Pet: ${codeData.pet.name} (${codeData.pet.rarity})\\n`;
        }

        await this.db.recordCodeUsage(player.phone, code);
        await this.sendMessage(jid, text);
    }

    async claimDaily(jid, player) {
        const lastDaily = player.last_daily ? moment(player.last_daily) : null;
        const now = moment();
        
        if (lastDaily && now.diff(lastDaily, 'hours') < 24) {
            const nextClaim = lastDaily.add(24, 'hours');
            const duration = moment.duration(nextClaim.diff(now));
            return await this.sendMessage(jid, 
                `⏰ Already claimed!\\n` +
                `Next claim in: ${duration.hours()}h ${duration.minutes()}m`
            );
        }

        const baseReward = parseInt(process.env.DAILY_REWARD_BASE) || 1000;
        const levelBonus = player.level * (parseInt(process.env.DAILY_REWARD_LEVEL_BONUS) || 100);
        const totalReward = baseReward + levelBonus;

        await this.db.updatePlayer(player.phone, {
            points: player.points + totalReward,
            last_daily: now.toISOString()
        });

        await this.sendMessage(jid, 
            `🎁 *Daily Reward Claimed!*\\n\\n` +
            `💰 +${totalReward.toLocaleString()} points\\n` +
            `(Base: ${baseReward} + Level bonus: ${levelBonus})\\n\\n` +
            `Come back tomorrow for more!`
        );
    }

    async showOnlinePlayers(jid) {
        const online = await this.db.getOnlinePlayers();
        
        if (online.length === 0) {
            return await this.sendMessage(jid, 'No players currently online.');
        }

        let text = `🟢 *Online Players (${online.length})*\\n\\n`;
        online.forEach((p, i) => {
            text += `${i + 1}. ${p.name} (Lv.${p.level})\\n`;
        });
        
        await this.sendMessage(jid, text);
    }

    async showLeaderboard(jid, args) {
        const type = args[0] || 'points';
        let leaders;
        let title;

        if (type === 'pvp' || type === 'ranked') {
            leaders = await this.db.getPvPLeaderboard(10);
            title = '🏆 PvP Rankings';
        } else {
            leaders = await this.db.getLeaderboard(10);
            title = '💰 Richest Players';
        }

        let text = `${title}\\n\\n`;
        leaders.forEach((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            if (type === 'pvp' || type === 'ranked') {
                text += `${medal} ${p.name} - ${p.elo_rating} ELO (${p.rank_tier})\\n`;
                text += `   ⚔️ ${p.pvp_wins}W/${p.pvp_losses}L\\n\\n`;
            } else {
                text += `${medal} ${p.name} - ${p.points.toLocaleString()}💰\\n`;
                text += `   ⚔️ ${p.wins}W | Lv.${p.level}\\n\\n`;
            }
        });

        await this.sendMessage(jid, text);
    }

    async sendUpdateNotes(jid) {
        const text = `📝 *Latest Updates - V2.0*\\n\\n` +
            `✨ *New Features:*\\n` +
            `• Multiplayer group battles\\n` +
            `• PvP ranked mode with ELO\\n` +
            `• Real-time trading system\\n` +
            `• Advanced stealing mechanics\\n` +
            `• World boss raids\\n` +
            `• Message editing for battles\\n\\n` +
            `🎮 *Improvements:*\\n` +
            `• Better battle UI\\n` +
            `• Faster response times\\n` +
            `• Auto-reconnect\\n` +
            `• Better mobile support\\n\\n` +
            `📱 *Termux Ready:*\\n` +
            `• Optimized for Android\\n` +
            `• Low resource usage\\n` +
            `• Background processing`;
        
        await this.sendMessage(jid, text);
    }

    // ==================== PvE BATTLE ====================

    async startPvE(jid, player) {
        const result = await this.pve.startBattle(player, jid);
        
        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        // Send initial battle message
        const sent = await this.sendMessage(jid, result.message);
        
        // Store message ID for editing (if supported)
        if (sent && sent.key) {
            await this.db.updateBattle(player.phone, { message_id: sent.key.id });
        }
    }

    async handleBattleAction(jid, player, action) {
        const result = await this.pve.processAction(player.phone, action);
        
        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        // Try to edit message if we have message_id
        const battle = await this.db.getActiveBattle(player.phone);
        if (battle && battle.message_id) {
            try {
                await this.bot.sock.sendMessage(jid, {
                    text: result.messages.join('\\n'),
                    edit: battle.message_id
                });
            } catch (e) {
                // Fallback to new message
                await this.sendMessage(jid, result.messages.join('\\n'));
            }
        } else {
            await this.sendMessage(jid, result.messages.join('\\n'));
        }

        // Send victory/defeat summary
        if (result.won && result.rewards) {
            let summary = `🎉 *VICTORY!*\\n\\n`;
            summary += `💰 +${result.rewards.points.toLocaleString()} points\\n`;
            summary += `⭐ +${result.rewards.exp} EXP\\n`;
            if (result.rewards.leveledUp) {
                summary += `📈 LEVEL UP! Now level ${result.rewards.newLevel}!\\n`;
            }
            await this.sendMessage(jid, summary);
        } else if (result.lost) {
            await this.sendMessage(jid, `💀 *DEFEAT!*\\nYou were knocked out! Rest and try again with ${this.prefix}heal`);
        }
    }

    // ==================== PvP ====================

    async findPvP(jid, player) {
        const result = await this.pvp.findRankedMatch(player);
        
        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        if (result.queued) {
            return await this.sendMessage(jid, result.message);
        }

        // Match found - notify both players
        await this.sendMessage(jid, result.message);
        
        // Notify opponent
        const opponentJid = `${result.opponent.phone}@s.whatsapp.net`;
        const opponentMsg = this.pvp.formatMatchStart(result.battle, result.opponent);
        await this.sendMessage(opponentJid, opponentMsg);
    }

    async cancelPvP(jid, player) {
        this.pvp.removeFromQueue(player.phone);
        await this.sendMessage(jid, '✅ Removed from matchmaking queue.');
    }

    async showRank(jid, player) {
        const stats = await this.pvp.getPvPStats(player.phone);
        const rankInfo = stats.rank;
        
        const text = `🏆 *Your PvP Rank*\\n\\n` +
            `${rankInfo.emoji} ${rankInfo.tier.toUpperCase()}\\n` +
            `📊 ELO Rating: ${stats.elo}\\n` +
            `⚔️ Matches: ${stats.totalMatches}\\n` +
            `✅ Wins: ${stats.wins}\\n` +
            `❌ Losses: ${stats.losses}\\n` +
            `📈 Win Rate: ${stats.winRate}%\\n\\n` +
            `Next rank: ${stats.elo < 3500 ? (rankInfo.max_elo + 1) + ' ELO needed' : 'MAX RANK!'}`;
        
        await this.sendMessage(jid, text);
    }

    // ==================== GROUP BATTLES ====================

    async startGroupBattle(jid, player, args) {
        const bossName = args.join(' ');
        const result = await this.group.createBattle(player, jid, { bossName });
        
        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        await this.sendMessage(jid, result.message);
    }

    async joinGroupBattle(jid, player) {
        const result = await this.group.joinBattle(jid, player);
        
        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        await this.sendMessage(jid, result.message);
    }

    async handleGroupAction(jid, player, command) {
        const action = command.replace('g', '');
        const result = await this.group.processAction(jid, player.phone, action);
        
        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        if (result.status) {
            return await this.sendMessage(jid, result.message);
        }

        await this.sendMessage(jid, result.message);

        if (result.enemyDefeated) {
            await this.sendMessage(jid, `🎉 *VICTORY!* The boss has been defeated! Rewards distributed to all survivors!`);
        }
    }

    // ==================== TRADING ====================

    async initiateTrade(jid, player, args) {
        if (args.length === 0) {
            return await this.sendMessage(jid, `Usage: ${this.prefix}trade [phone number]`);
        }

        const result = await this.trading.initiateTrade(player, args[0]);
        
        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        await this.sendMessage(jid, result.message);
        
        // Notify target
        const notification = this.trading.formatTradeNotification(
            { offer_points: 0, offer_pet_id: null },
            player
        );
        await this.sendMessage(result.targetJid, notification);
    }

    async acceptTrade(jid, player, args) {
        if (args.length === 0) {
            return await this.sendMessage(jid, `Usage: ${this.prefix}accept [trade ID]`);
        }

        const result = await this.trading.acceptTrade(args[0], player.phone);
        
        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        await this.sendMessage(jid, result.message);
    }

    async declineTrade(jid, player, args) {
        if (args.length === 0) {
            return await this.sendMessage(jid, `Usage: ${this.prefix}decline [trade ID]`);
        }

        const result = await this.trading.declineTrade(args[0], player.phone);
        await this.sendMessage(jid, result.message);
    }

    async showPendingTrades(jid, player) {
        const trades = await this.trading.getPendingTrades(player.phone);
        
        if (trades.length === 0) {
            return await this.sendMessage(jid, 'No pending trade requests.');
        }

        let text = `📋 *Pending Trades*\\n\\n`;
        for (const trade of trades) {
            const fromPlayer = await this.db.getPlayer(trade.from_phone);
            text += `ID: ${trade.id} from ${fromPlayer?.name || 'Unknown'}\\n`;
            text += `Use: ${this.prefix}accept ${trade.id} or ${this.prefix}decline ${trade.id}\\n\\n`;
        }
        
        await this.sendMessage(jid, text);
    }

    // ==================== STEALING ====================

    async attemptSteal(jid, player, args) {
        if (args.length === 0) {
            // Show targets
            const targets = await this.stealing.getStealTargets(player);
            return await this.sendMessage(jid, this.stealing.formatStealList(targets));
        }

        const result = await this.stealing.attemptSteal(player, args[0]);
        
        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        await this.sendMessage(jid, result.message);

        if (result.targetMessage && result.targetJid) {
            await this.sendMessage(result.targetJid, result.targetMessage);
        }
    }

    async showStealTargets(jid) {
        // This is handled by attemptSteal when no args provided
        await this.sendMessage(jid, `Use ${this.prefix}steal to see targets`);
    }

    // ==================== ECONOMY ====================

    async handleBank(jid, player, args) {
        if (args.length === 0) {
            const info = await this.bank.getBankInfo(player);
            return await this.sendMessage(jid, this.bank.formatBankInfo(info, player));
        }

        const action = args[0].toLowerCase();
        const amount = args[1];

        let result;
        switch(action) {
            case 'deposit':
                result = await this.bank.deposit(player, amount);
                break;
            case 'withdraw':
                result = await this.bank.withdraw(player, amount);
                break;
            case 'upgrade':
                result = await this.bank.upgradeTier(player);
                break;
            default:
                return await this.sendMessage(jid, 'Usage: /bank [deposit/withdraw/upgrade] [amount]');
        }

        if (result.error) {
            return await this.sendMessage(jid, `❌ ${result.error}`);
        }

        await this.sendMessage(jid, result.message);
    }

    async showShop(jid, player) {
        const items = this.game.config.shop_items;
        
        let text = `🏪 *Item Shop*\\n\\n`;
        text += `💰 Your points: ${player.points.toLocaleString()}\\n\\n`;
        
        for (const [key, item] of Object.entries(items)) {
            text += `${item.emoji} *${item.name}* - ${item.price.toLocaleString()}💰\\n`;
            text += `   ${item.description}\\n`;
            text += `   Buy: ${this.prefix}buy ${key}\\n\\n`;
        }
        
        await this.sendMessage(jid, text);
    }

    async buyItem(jid, player, args) {
        if (args.length === 0) {
            return await this.sendMessage(jid, `Usage: ${this.prefix}buy [item name]`);
        }

        const itemKey = args[0].toLowerCase();
        const item = this.game.config.shop_items[itemKey];
        
        if (!item) {
            return await this.sendMessage(jid, '❌ Item not found! Use ' + this.prefix + 'shop to see items.');
        }

        if (player.points < item.price) {
            return await this.sendMessage(jid, `❌ Not enough points! Need ${item.price.toLocaleString()}, have ${player.points.toLocaleString()}`);
        }

        // Process purchase
        await this.db.updatePlayer(player.phone, {
            points: player.points - item.price
        });

        // Apply effect
        if (item.effect === 'heal') {
            const newHp = Math.min(player.max_hp, player.hp + item.value);
            await this.db.updatePlayer(player.phone, { hp: newHp });
        } else if (item.effect === 'shield') {
            const expires = moment().add(item.duration, 'hours').toISOString();
            await this.db.updatePlayer(player.phone, {
                shield_active: 1,
                shield_expires: expires
            });
        }

        await this.addItem(player.phone, 'consumable', itemKey, 1);

        await this.sendMessage(jid, `✅ Purchased ${item.name} for ${item.price.toLocaleString()} points!`);
    }

    async handleCrates(jid, player, args) {
        if (args.length === 0) {
            let text = `📦 *Crate Shop*\\n\\n`;
            text += `💰 Your points: ${player.points.toLocaleString()}\\n\\n`;
            
            for (const [key, crate] of Object.entries(this.game.config.crates)) {
                text += `${crate.emoji} *${crate.name}* - ${crate.cost.toLocaleString()}💰\\n`;
                text += `   Drops: ${Object.entries(crate.drops).map(([r, c]) => `${r} ${c}%`).join(', ')}\\n`;
                text += `   Buy: ${this.prefix}crates ${key}\\n\\n`;
            }
            
            return await this.sendMessage(jid, text);
        }

        const crateType = args[0].toLowerCase();
        const crate = this.game.config.crates[crateType];
        
        if (!crate) {
            return await this.sendMessage(jid, '❌ Invalid crate type!');
        }

        if (player.points < crate.cost) {
            return await this.sendMessage(jid, `❌ Need ${crate.cost.toLocaleString()} points!`);
        }

        // Open crate
        const result = this.game.openCrate(crateType);
        
        // Deduct points
        await this.db.updatePlayer(player.phone, {
            points: player.points - crate.cost
        });

        // Add pet
        if (result.pet) {
            await this.db.addPet(player.phone, result.pet);
        }

        const rarityEmoji = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡', mythic: '🔴' }[result.rarity];
        
        await this.sendMessage(jid, 
            `🎉 *${crate.name} Opened!*\\n\\n` +
            `${rarityEmoji} You got: *${result.pet.name}*\\n` +
            `⭐ Rarity: ${result.rarity.toUpperCase()}\\n` +
            `⚔️ ATK: +${result.pet.atk}\\n\\n` +
            `Use ${this.prefix}equip to use it!`
        );
    }

    async showPets(jid, player) {
        const pets = await this.db.getPets(player.phone);
        
        if (pets.length === 0) {
            return await this.sendMessage(jid, '🐾 No pets yet! Open crates with ' + this.prefix + 'crates');
        }

        let text = `🐾 *Your Pets (${pets.length})*\\n\\n`;
        
        pets.forEach((pet, i) => {
            const emoji = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡', mythic: '🔴' }[pet.rarity];
            const equipped = pet.equipped ? ' ✅ EQUIPPED' : '';
            text += `${i + 1}. ${emoji} ${pet.name} (+${pet.atk} ATK)${equipped}\\n`;
        });
        
        text += `\\nUse ${this.prefix}equip [number] to equip`;
        
        await this.sendMessage(jid, text);
    }

    async equipPet(jid, player, args) {
        if (args.length === 0) {
            return await this.sendMessage(jid, `Usage: ${this.prefix}equip [pet number]`);
        }

        const index = parseInt(args[0]) - 1;
        const pets = await this.db.getPets(player.phone);
        
        if (isNaN(index) || index < 0 || index >= pets.length) {
            return await this.sendMessage(jid, '❌ Invalid pet number! Use ' + this.prefix + 'pets to see your pets.');
        }

        const pet = pets[index];
        await this.db.equipPet(player.phone, pet.id);
        
        await this.sendMessage(jid, `✅ Equipped ${pet.name}! (+${pet.atk} ATK)`);
    }

    async healPlayer(jid, player) {
        if (player.hp >= player.max_hp) {
            return await this.sendMessage(jid, '❤️ You are already at full health!');
        }

        const result = await this.pve.healPlayer(player.phone);
        
        await this.sendMessage(jid, 
            `💚 *Healed!*\\n` +
            `Restored ${result.healed} HP\\n` +
            `Current: ${result.currentHp}/${result.maxHp}`
        );
    }

    // ==================== BOSS ====================

    async handleBoss(jid, player, args) {
        if (args[0] === 'attack') {
            const result = await this.boss.processAttack(player.phone);
            
            if (result.error) {
                return await this.sendMessage(jid, `❌ ${result.error}`);
            }

            let text = `⚔️ *Boss Battle*\\n\\n`;
            text += `You dealt ${result.damage.toLocaleString()} damage!\\n`;
            text += `Total damage: ${result.totalDamage.toLocaleString()}\\n`;
            text += `${this.formatBossHealth(result.bossHp, result.bossMaxHp)}\\n`;

            if (result.defeated) {
                text += `\\n🎉 *BOSS DEFEATED!*\\n`;
                text += `Rewards distributed to all participants!`;
            }

            await this.sendMessage(jid, text);
        } else if (args[0] === 'status') {
            const status = await this.boss.getBossStatus();
            if (status.error) {
                return await this.sendMessage(jid, status.error);
            }
            await this.sendMessage(jid, status.message);
        } else {
            // Join boss battle
            const result = await this.boss.joinBattle(player.phone);
            
            if (result.error) {
                return await this.sendMessage(jid, `❌ ${result.error}`);
            }

            await this.sendMessage(jid, result.message);
        }
    }

    formatBossHealth(current, max) {
        const percentage = Math.floor((current / max) * 10);
        const filled = '█'.repeat(percentage);
        const empty = '░'.repeat(10 - percentage);
        return `👹 [${filled}${empty}] ${current.toLocaleString()}/${max.toLocaleString()} HP`;
    }

    // ==================== ADMIN ====================

    async handleAdminCommand(command, args, jid, player) {
        const adminPhone = process.env.ADMIN_NUMBER;
        
        if (player.phone !== adminPhone) {
            return await this.sendMessage(jid, '⛔ Admin only!');
        }

        const subCommand = command.replace('admin', '').trim();
        
        switch(subCommand) {
            case 'givepoints':
                if (args.length < 2) return await this.sendMessage(jid, 'Usage: admin givepoints [phone] [amount]');
                const targetPhone = args[0].replace(/[^0-9]/g, '');
                const amount = parseInt(args[1]);
                const target = await this.db.getPlayer(targetPhone);
                if (!target) return await this.sendMessage(jid, 'Player not found!');
                await this.db.updatePlayer(targetPhone, { points: target.points + amount });
                await this.sendMessage(jid, `✅ Gave ${amount.toLocaleString()} points to ${target.name}`);
                await this.sendMessage(`${targetPhone}@s.whatsapp.net`, `🎁 Admin gave you ${amount.toLocaleString()} points!`);
                break;

            case 'broadcast':
                const message = args.join(' ');
                const players = await this.db.getAllPlayers();
                let sent = 0;
                for (const p of players) {
                    try {
                        await this.sendMessage(`${p.phone}@s.whatsapp.net`, `📢 *Broadcast*\\n\\n${message}\\n\\n- Admin`);
                        sent++;
                    } catch (e) {}
                }
                await this.sendMessage(jid, `✅ Broadcast sent to ${sent} players`);
                break;

            case 'maintenance':
                const mode = args[0] === 'on';
                process.env.MAINTENANCE_MODE = mode.toString();
                await this.sendMessage(jid, `🔧 Maintenance mode ${mode ? 'ENABLED' : 'DISABLED'}`);
                break;

            case 'ban':
                if (args.length < 2) return await this.sendMessage(jid, 'Usage: admin ban [phone] [reason]');
                const banPhone = args[0].replace(/[^0-9]/g, '');
                const reason = args.slice(1).join(' ');
                await this.db.updatePlayer(banPhone, { banned: 1, ban_reason: reason });
                await this.sendMessage(jid, `🚫 Banned ${banPhone}`);
                break;

            case 'unban':
                const unbanPhone = args[0].replace(/[^0-9]/g, '');
                await this.db.updatePlayer(unbanPhone, { banned: 0, ban_reason: null });
                await this.sendMessage(jid, `✅ Unbanned ${unbanPhone}`);
                break;

            case 'spawnboss':
                const bossName = args.join(' ') || null;
                const result = await this.boss.spawnBoss(player.phone, bossName);
                if (result.success) {
                    await this.sendMessage(jid, result.message);
                    // Broadcast to all
                    const allPlayers = await this.db.getAllPlayers();
                    for (const p of allPlayers) {
                        if (p.phone !== player.phone) {
                            await this.sendMessage(`${p.phone}@s.whatsapp.net`, result.message);
                        }
                    }
                } else {
                    await this.sendMessage(jid, result.error || 'Failed to spawn boss');
                }
                break;

            case 'stats':
                const allPlayers = await this.db.getAllPlayers();
                const totalPoints = allPlayers.reduce((sum, p) => sum + p.points, 0);
                await this.sendMessage(jid, 
                    `📊 *Bot Statistics*\\n\\n` +
                    `👥 Total Players: ${allPlayers.length}\\n` +
                    `💰 Total Points: ${totalPoints.toLocaleString()}\\n` +
                    `⚔️ Total Battles: ${allPlayers.reduce((sum, p) => sum + p.wins + p.losses, 0)}\\n` +
                    `🏆 PvP Matches: ${allPlayers.reduce((sum, p) => sum + p.pvp_wins + p.pvp_losses, 0)}`
                );
                break;

            default:
                await this.sendMessage(jid, 
                    `Admin commands:\\n` +
                    `givepoints, broadcast, maintenance, ban, unban, spawnboss, stats`
                );
        }
    }

    // ==================== UTILITY ====================

    async sendMessage(jid, text) {
        try {
            if (process.env.TYPING_INDICATOR === 'true') {
                await this.bot.sock.sendPresenceUpdate('composing', jid);
                await new Promise(r => setTimeout(r, 500));
            }
            
            const sent = await this.bot.sock.sendMessage(jid, { text: text });
            await this.bot.sock.sendPresenceUpdate('paused', jid);
            return sent;
        } catch (error) {
            console.error(chalk.red('Error sending message:'), error.message);
        }
    }

    async addItem(phone, type, name, qty) {
        await this.db.addItem(phone, type, name, qty);
    }
}

module.exports = MessageHandler;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/handlers/messageHandler.js', 'w') as f:
    f.write(message_handler)

print("✅ 15. src/handlers/messageHandler.js created")