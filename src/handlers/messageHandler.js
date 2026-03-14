const GameEngine = require('../core/gameEngine');
const ConfigLoader = require('../core/configLoader');
const Helpers = require('../utils/helpers');

// Systems
const PveSystem = require('../systems/pveSystem');
const PvpSystem = require('../systems/pvpSystem');
const BankSystem = require('../systems/bankSystem');
const ShopSystem = require('../systems/shopSystem');
const PetSystem = require('../systems/petSystem');
const TradeSystem = require('../systems/tradeSystem');
const StealSystem = require('../systems/stealSystem');
const AdminSystem = require('../systems/adminSystem');
const GroupBattleSystem = require('../systems/groupBattleSystem');
const WorldBossSystem = require('../systems/worldBossSystem');
const GuildSystem = require('../systems/guildSystem');
const QuestSystem = require('../systems/questSystem');

class MessageHandler {
    static async handle(sock, msg) {
        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        const phone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
        
        // Get message text
        let text = '';
        if (msg.message.conversation) {
            text = msg.message.conversation;
        } else if (msg.message.extendedTextMessage?.text) {
            text = msg.message.extendedTextMessage.text;
        } else if (msg.message.imageMessage?.caption) {
            text = msg.message.imageMessage.caption;
        } else if (msg.message.videoMessage?.caption) {
            text = msg.message.videoMessage.caption;
        }
        
        text = text.trim();
        
        // Check for prefix
        const prefix = process.env.BOT_PREFIX || '/';
        if (!text.startsWith(prefix)) return;
        
        const args = text.slice(prefix.length).split(' ');
        const command = args.shift().toLowerCase();
        
        // Get or create player
        let player = GameEngine.getPlayer(phone);
        if (!player && command !== 'start' && command !== 'help') {
            return sock.sendMessage(jid, { 
                text: `👋 Welcome! Please create an account first with ${prefix}start [your name]` 
            });
        }
        
        // Check maintenance mode
        if (process.env.MAINTENANCE_MODE === 'true' && !GameEngine.isAdmin(phone)) {
            return sock.sendMessage(jid, { 
                text: `🔧 ${process.env.MAINTENANCE_MESSAGE || 'Bot is under maintenance'}` 
            });
        }
        
        // Check banned
        if (player?.banned) {
            const banMsg = player.ban_expires 
                ? `⛔ You are banned until ${new Date(player.ban_expires).toLocaleString()}`
                : '⛔ You are permanently banned.';
            return sock.sendMessage(jid, { text: banMsg + `\nReason: ${player.ban_reason || 'No reason provided'}` });
        }
        
        // Rate limiting
        if (!GameEngine.checkRateLimit(phone)) {
            return sock.sendMessage(jid, { text: '⏰ Too many commands. Please slow down.' });
        }
        
        // Update activity
        if (player) {
            GameEngine.updateActivity(phone);
        }
        
        try {
            // Show typing indicator
            if (process.env.ENABLE_TYPING_INDICATOR === 'true') {
                await sock.sendPresenceUpdate('composing', jid);
            }
            
            await this.processCommand(sock, phone, jid, command, args, isGroup, player);
            
            // Stop typing
            await sock.sendPresenceUpdate('paused', jid);
            
        } catch (err) {
            console.error('Command error:', err);
            await sock.sendMessage(jid, { text: '❌ An error occurred. Please try again.' });
            await sock.sendPresenceUpdate('paused', jid);
        }
    }
    
    static async processCommand(sock, phone, jid, command, args, isGroup, player) {
        const config = global.gameConfig;
        
        switch(command) {
            // ==================== BASIC COMMANDS ====================
            case 'start':
            case 'register':
                await this.handleStart(sock, phone, jid, args);
                break;
                
            case 'menu':
            case 'help':
                await this.handleMenu(sock, jid, isGroup);
                break;
                
            case 'stats':
            case 'profile':
            case 'me':
                await this.handleStats(sock, phone, jid, args[0]);
                break;
                
            case 'daily':
            case 'claim':
                if (config.features.dailyRewards) {
                    await this.handleDaily(sock, phone, jid);
                } else {
                    await sock.sendMessage(jid, { text: '❌ Daily rewards are currently disabled.' });
                }
                break;
                
            case 'leaderboard':
            case 'top':
                if (config.features.leaderboard) {
                    await this.handleLeaderboard(sock, jid, args[0]);
                }
                break;
                
            case 'online':
                await this.handleOnline(sock, jid);
                break;
                
            case 'tutorial':
            case 'guide':
                await this.handleTutorial(sock, jid);
                break;
                
            case 'settings':
                await this.handleSettings(sock, phone, jid, args);
                break;
                
            case 'inventory':
            case 'inv':
            case 'items':
                await this.handleInventory(sock, phone, jid);
                break;
                
            case 'use':
                await this.handleUseItem(sock, phone, jid, args);
                break;
                
            // ==================== BATTLE COMMANDS ====================
            case 'battle':
            case 'fight':
                await PveSystem.startBattle(sock, phone, jid, args[0]);
                break;
                
            case 'attack':
            case 'atk':
                await PveSystem.attack(sock, phone, jid);
                break;
                
            case 'defend':
            case 'def':
                await PveSystem.defend(sock, phone, jid);
                break;
                
            case 'heal':
                await PveSystem.heal(sock, phone, jid);
                break;
                
            case 'flee':
            case 'run':
                await PveSystem.flee(sock, phone, jid);
                break;
                
            case 'special':
            case 'ult':
            case 'ultimate':
                await PveSystem.special(sock, phone, jid);
                break;
                
            case 'status':
            case 'battlestatus':
                await PveSystem.status(sock, phone, jid);
                break;
                
            // ==================== PVP COMMANDS ====================
            case 'ranked':
            case 'match':
                if (config.features.pvp) {
                    await PvpSystem.findMatch(sock, phone, jid);
                } else {
                    await sock.sendMessage(jid, { text: '❌ PvP is currently disabled.' });
                }
                break;
                
            case 'rank':
            case 'elo':
                if (config.features.pvp) {
                    await PvpSystem.showRank(sock, phone, jid);
                }
                break;
                
            case 'accept':
                if (config.features.pvp) {
                    await PvpSystem.acceptMatch(sock, phone, jid, args[0]);
                }
                break;
                
            case 'decline':
            case 'reject':
                if (config.features.pvp) {
                    await PvpSystem.declineMatch(sock, phone, jid, args[0]);
                }
                break;
                
            case 'pvpstats':
            case 'pvplog':
                if (config.features.pvp) {
                    await PvpSystem.showHistory(sock, phone, jid);
                }
                break;
                
            // ==================== ECONOMY COMMANDS ====================
            case 'bank':
                await BankSystem.handle(sock, phone, jid, args);
                break;
                
            case 'shop':
            case 'store':
                if (config.features.shop) {
                    await ShopSystem.show(sock, jid, args[0]);
                }
                break;
                
            case 'buy':
                if (config.features.shop) {
                    await ShopSystem.buy(sock, phone, jid, args);
                }
                break;
                
            case 'sell':
                if (config.features.shop) {
                    await ShopSystem.sell(sock, phone, jid, args);
                }
                break;
                
            case 'crates':
            case 'box':
            case 'crate':
                if (config.features.pets) {
                    await ShopSystem.crates(sock, phone, jid, args);
                }
                break;
                
            case 'market':
                await ShopSystem.showMarket(sock, jid, args);
                break;
                
            case 'list':
                await ShopSystem.listItem(sock, phone, jid, args);
                break;
                
            // ==================== PET COMMANDS ====================
            case 'pets':
            case 'pet':
                if (config.features.pets) {
                    await PetSystem.showPets(sock, phone, jid);
                }
                break;
                
            case 'petinfo':
            case 'petstats':
                if (config.features.pets) {
                    await PetSystem.showPetInfo(sock, phone, jid, args[0]);
                }
                break;
                
            case 'equip':
                if (config.features.pets) {
                    await PetSystem.equip(sock, phone, jid, args[0]);
                }
                break;
                
            case 'unequip':
                if (config.features.pets) {
                    await PetSystem.unequip(sock, phone, jid);
                }
                break;
                
            case 'feed':
                if (config.features.pets) {
                    await PetSystem.feed(sock, phone, jid, args);
                }
                break;
                
            case 'train':
                if (config.features.pets) {
                    await PetSystem.train(sock, phone, jid, args);
                }
                break;
                
            case 'release':
                if (config.features.pets) {
                    await PetSystem.release(sock, phone, jid, args);
                }
                break;
                
            // ==================== TRADING COMMANDS ====================
            case 'trade':
                if (config.features.trading) {
                    await TradeSystem.request(sock, phone, jid, args);
                } else {
                    await sock.sendMessage(jid, { text: '❌ Trading is currently disabled.' });
                }
                break;
                
            case 'accepttrade':
            case 'confirm':
                if (config.features.trading) {
                    await TradeSystem.accept(sock, phone, jid, args[0]);
                }
                break;
                
            case 'declinetrade':
            case 'canceltrade':
                if (config.features.trading) {
                    await TradeSystem.decline(sock, phone, jid, args[0]);
                }
                break;
                
            case 'trades':
            case 'offers':
                if (config.features.trading) {
                    await TradeSystem.list(sock, phone, jid);
                }
                break;
                
            case 'tradehistory':
                if (config.features.trading) {
                    await TradeSystem.history(sock, phone, jid);
                }
                break;
                
            // ==================== STEALING COMMANDS ====================
            case 'steal':
            case 'rob':
                if (config.features.stealing) {
                    await StealSystem.handle(sock, phone, jid, args);
                } else {
                    await sock.sendMessage(jid, { text: '❌ Stealing is currently disabled.' });
                }
                break;
                
            case 'targets':
            case 'victims':
                if (config.features.stealing) {
                    await StealSystem.showTargets(sock, phone, jid);
                }
                break;
                
            case 'shield':
            case 'protect':
                await StealSystem.buyShield(sock, phone, jid);
                break;
                
            // ==================== GROUP BATTLE COMMANDS ====================
            case 'groupbattle':
            case 'raid':
            case 'gbattle':
                if (config.features.groupBattles && isGroup) {
                    await GroupBattleSystem.start(sock, phone, jid, args);
                } else if (!isGroup) {
                    await sock.sendMessage(jid, { text: '❌ Group battles can only be started in groups.' });
                }
                break;
                
            case 'joingroup':
            case 'joinraid':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.join(sock, phone, jid, args[0]);
                }
                break;
                
            case 'gattack':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.attack(sock, phone, jid);
                }
                break;
                
            case 'gheal':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.heal(sock, phone, jid, args[0]);
                }
                break;
                
            case 'gstatus':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.status(sock, jid);
                }
                break;
                
            // ==================== WORLD BOSS COMMANDS ====================
            case 'boss':
            case 'worldboss':
                if (config.features.worldBosses) {
                    await WorldBossSystem.info(sock, jid);
                }
                break;
                
            case 'bossattack':
            case 'batk':
                if (config.features.worldBosses) {
                    await WorldBossSystem.attack(sock, phone, jid);
                }
                break;
                
            case 'bossstatus':
                if (config.features.worldBosses) {
                    await WorldBossSystem.status(sock, jid);
                }
                break;
                
            case 'bossrewards':
            case 'bossrank':
                if (config.features.worldBosses) {
                    await WorldBossSystem.leaderboard(sock, jid);
                }
                break;
                
            // ==================== GUILD COMMANDS ====================
            case 'guild':
            case 'clan':
                await GuildSystem.info(sock, phone, jid);
                break;
                
            case 'createguild':
                await GuildSystem.create(sock, phone, jid, args);
                break;
                
            case 'joinguild':
                await GuildSystem.join(sock, phone, jid, args[0]);
                break;
                
            case 'leaveguild':
                await GuildSystem.leave(sock, phone, jid);
                break;
                
            case 'guildmembers':
                await GuildSystem.members(sock, phone, jid);
                break;
                
            case 'guilddeposit':
                await GuildSystem.deposit(sock, phone, jid, args[0]);
                break;
                
            case 'guildupgrade':
                await GuildSystem.upgrade(sock, phone, jid);
                break;
                
            // ==================== QUEST COMMANDS ====================
            case 'quests':
            case 'missions':
                await QuestSystem.list(sock, phone, jid);
                break;
                
            case 'questinfo':
                await QuestSystem.info(sock, phone, jid, args[0]);
                break;
                
            case 'claimreward':
                await QuestSystem.claim(sock, phone, jid, args[0]);
                break;
                
            // ==================== SOCIAL COMMANDS ====================
            case 'msg':
            case 'message':
                await this.handleMessageUser(sock, phone, jid, args);
                break;
                
            case 'inbox':
            case 'messages':
                await this.handleInbox(sock, phone, jid);
                break;
                
            case 'read':
                await this.handleReadMessage(sock, phone, jid, args[0]);
                break;
                
            case 'clearmessages':
                await this.handleClearMessages(sock, phone, jid);
                break;
                
            case 'gift':
                await this.handleGift(sock, phone, jid, args);
                break;
                
            // ==================== ACHIEVEMENT COMMANDS ====================
            case 'achievements':
            case 'ach':
                await this.handleAchievements(sock, phone, jid);
                break;
                
            case 'titles':
                await this.handleTitles(sock, phone, jid);
                break;
                
            // ==================== ADMIN COMMANDS ====================
            case 'admin':
                await AdminSystem.handle(sock, phone, jid, args);
                break;
                
            case 'broadcast':
            case 'bc':
                await AdminSystem.broadcast(sock, phone, args.join(' '));
                break;
                
            case 'givepoints':
            case 'addpoints':
                await AdminSystem.givePoints(sock, phone, args);
                break;
                
            case 'removepoints':
                await AdminSystem.removePoints(sock, phone, args);
                break;
                
            case 'setlevel':
                await AdminSystem.setLevel(sock, phone, args);
                break;
                
            case 'ban':
                await AdminSystem.ban(sock, phone, args);
                break;
                
            case 'unban':
                await AdminSystem.unban(sock, phone, args);
                break;
                
            case 'mute':
                await AdminSystem.mute(sock, phone, args);
                break;
                
            case 'unmute':
                await AdminSystem.unmute(sock, phone, args);
                break;
                
            case 'spawnboss':
            case 'summon':
                await AdminSystem.spawnBoss(sock, phone, args);
                break;
                
            case 'maintenance':
                await AdminSystem.maintenance(sock, phone, args);
                break;
                
            case 'reload':
                await AdminSystem.reloadConfig(sock, phone);
                break;
                
            case 'backup':
                await AdminSystem.backup(sock, phone);
                break;
                
            case 'stats':
            case 'botstats':
                await AdminSystem.stats(sock, phone, jid);
                break;
                
            case 'eval':
                await AdminSystem.eval(sock, phone, args);
                break;
                
            // ==================== FUN/MISC COMMANDS ====================
            case 'roll':
                await this.handleRoll(sock, jid, args[0]);
                break;
                
            case 'flip':
                await this.handleCoinFlip(sock, jid);
                break;
                
            case 'rps':
                await this.handleRPS(sock, phone, jid, args[0]);
                break;
                
            case 'dice':
                await this.handleDice(sock, jid, args[0]);
                break;
                
            case 'ping':
                await sock.sendMessage(jid, { text: 'pong! 🏓' });
                break;
                
            case 'uptime':
                await this.handleUptime(sock, jid);
                break;
                
            case 'version':
                await sock.sendMessage(jid, { text: '🎮 ODD RPG Bot v2.0.0\nPowered by Baileys' });
                break;
                
            case 'report':
                await this.handleReport(sock, phone, jid, args);
                break;
                
            case 'suggest':
                await this.handleSuggest(sock, phone, jid, args);
                break;
                
            default:
                await sock.sendMessage(jid, { 
                    text: `❓ Unknown command: ${command}\nType ${process.env.BOT_PREFIX || '/'}menu for help.` 
                });
        }
    }
    
    // ==================== HANDLER METHODS ====================
    
    static async handleStart(sock, phone, jid, args) {
        const existing = GameEngine.getPlayer(phone);
        if (existing) {
            return sock.sendMessage(jid, { 
                text: `✅ You already have an account!\nName: ${existing.name}\nLevel: ${existing.level}\n\nUse /stats to see your profile.` 
            });
        }
        
        const name = args.join(' ').trim() || 'Player';
        if (name.length > 20) {
            return sock.sendMessage(jid, { text: '❌ Name too long (max 20 characters)' });
        }
        
        const player = GameEngine.createPlayer(phone, name);
        const config = global.gameConfig;
        
        // Give starter pet
        if (config.features.pets) {
            GameEngine.givePet(phone, 'Common');
        }
        
        // Give starter items
        if (config.features.shop) {
            GameEngine.addItem(phone, 'consumable', 'Health Potion', 5);
        }
        
        const text = `🎮 *Welcome to ${config.botName}!*\n\n` +
            `👤 Name: ${player.name}\n` +
            `📱 Phone: ${phone}\n` +
            `❤️ HP: ${player.hp}/${player.max_hp}\n` +
            `⚔️ Attack: ${player.attack}\n` +
            `🛡️ Defense: ${player.defense}\n` +
            `💨 Speed: ${player.speed}\n` +
            `💰 Points: ${Helpers.formatNumber(player.points)}\n\n` +
            `🎁 *Starter Pack:*\n` +
            (config.features.pets ? `• 1 Random Pet\n` : '') +
            (config.features.shop ? `• 5 Health Potions\n` : '') +
            `\nType /menu to see all commands!`;
            
        await sock.sendMessage(jid, { text });
    }
    
    static async handleMenu(sock, jid, isGroup) {
        const prefix = process.env.BOT_PREFIX || '/';
        const config = global.gameConfig;
        
        let menu = `🎮 *${config.botName} - Commands*\n\n`;
        
        menu += `*📱 Basic:*\n`;
        menu += `${prefix}start [name] - Create account\n`;
        menu += `${prefix}menu - This menu\n`;
        menu += `${prefix}stats - Your profile\n`;
        menu += `${prefix}daily - Daily reward\n`;
        menu += `${prefix}leaderboard - Top players\n`;
        menu += `${prefix}inventory - Your items\n`;
        menu += `${prefix}settings - Bot settings\n\n`;
        
        menu += `*⚔️ Battle:*\n`;
        menu += `${prefix}battle - Start PvE battle\n`;
        menu += `${prefix}attack - Strike enemy\n`;
        menu += `${prefix}defend - Block 70% damage\n`;
        menu += `${prefix}heal - Restore HP\n`;
        menu += `${prefix}flee - Run away\n`;
        menu += `${prefix}special - Pet special attack\n\n`;
        
        if (config.features.pvp) {
            menu += `*🏆 PvP:*\n`;
            menu += `${prefix}ranked - Find ranked match\n`;
            menu += `${prefix}rank - Your PvP rank\n`;
            menu += `${prefix}pvpstats - Match history\n\n`;
        }
        
        menu += `*💰 Economy:*\n`;
        menu += `${prefix}bank - Bank menu\n`;
        if (config.features.shop) {
            menu += `${prefix}shop - Item shop\n`;
            menu += `${prefix}buy [item] - Purchase\n`;
        }
        if (config.features.pets) {
            menu += `${prefix}crates [type] - Open crates\n`;
        }
        menu += `\n`;
        
        if (config.features.pets) {
            menu += `*🐾 Pets:*\n`;
            menu += `${prefix}pets - View pets\n`;
            menu += `${prefix}equip [num] - Equip pet\n`;
            menu += `${prefix}feed [num] - Feed pet\n\n`;
        }
        
        if (config.features.trading) {
            menu += `*🔄 Trading:*\n`;
            menu += `${prefix}trade [phone] [points] - Request trade\n`;
            menu += `${prefix}trades - Pending trades\n\n`;
        }
        
        if (config.features.stealing) {
            menu += `*🦹 Stealing:*\n`;
            menu += `${prefix}steal [phone] - Steal points\n`;
            menu += `${prefix}shield - Buy protection\n\n`;
        }
        
        if (config.features.worldBosses) {
            menu += `*🐉 World Boss:*\n`;
            menu += `${prefix}boss - Current boss info\n`;
            menu += `${prefix}bossattack - Attack boss\n\n`;
        }
        
        if (isGroup && config.features.groupBattles) {
            menu += `*👥 Group (Group chats only):*\n`;
            menu += `${prefix}groupbattle - Start raid\n`;
            menu += `${prefix}joingroup - Join raid\n\n`;
        }
        
        menu += `*💬 Social:*\n`;
        menu += `${prefix}msg [phone] [text] - Send message\n`;
        menu += `${prefix}inbox - Check messages\n`;
        menu += `${prefix}gift [phone] [amount] - Gift points\n\n`;
        
        menu += `Type ${prefix}tutorial for game guide!`;
        
        await sock.sendMessage(jid, { text: menu });
    }
    
    static async handleStats(sock, phone, jid, targetPhone) {
        let target = phone;
        if (targetPhone && GameEngine.isAdmin(phone)) {
            target = targetPhone.replace(/[^0-9]/g, '');
        }
        
        const player = GameEngine.getPlayer(target);
        if (!player) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        const config = global.gameConfig;
        const rank = config.ranks.find(r => player.elo >= r.min && player.elo <= r.max) || config.ranks[0];
        const equipped = GameEngine.getEquippedPet(target);
        const pets = GameEngine.getPlayerPets(target);
        
        let text = `📊 *${player.name}'s Profile*\n\n`;
        
        // Basic Info
        text += `📊 Level: ${player.level} (${Helpers.formatNumber(player.exp)} XP)\n`;
        const nextLevelExp = Helpers.getRequiredExp(player.level + 1);
        const currentLevelExp = Helpers.getRequiredExp(player.level);
        const expInLevel = player.exp - currentLevelExp;
        const expNeeded = nextLevelExp - currentLevelExp;
        const percent = Math.floor((expInLevel / expNeeded) * 100);
        text += `${Helpers.progressBar(expInLevel, expNeeded, 10)} ${percent}%\n\n`;
        
        // Stats
        text += `❤️ HP: ${player.hp}/${player.max_hp}\n`;
        text += `⚔️ Attack: ${player.attack}\n`;
        text += `🛡️ Defense: ${player.defense}\n`;
        text += `💨 Speed: ${player.speed}\n\n`;
        
        // Economy
        text += `💰 Wallet: ${Helpers.formatNumber(player.points)}\n`;
        text += `🏦 Bank: ${Helpers.formatNumber(player
