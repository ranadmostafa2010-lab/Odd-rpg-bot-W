const GameEngine = require('../core/gameEngine');
const ConfigLoader = require('../core/configLoader');
const Helpers = require('../utils/helpers');

// All Systems
const PveSystem = require('../system/pveSystem');
const PvpSystem = require('../system/pvpSystem');
const BankSystem = require('../system/bankSystem');
const ShopSystem = require('../system/shopSystem');
const PetSystem = require('../system/petSystem');
const TradeSystem = require('../system/tradeSystem');
const StealSystem = require('../system/stealSystem');
const AdminSystem = require('../system/adminSystem');
const GroupBattleSystem = require('../system/groupBattleSystem');
const WorldBossSystem = require('../system/worldBossSystem');
const GuildSystem = require('../system/guildSystem');
const QuestSystem = require('../system/questSystem');

class MessageHandler {
    static async handle(sock, msg) {
        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        const phone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
        
        // Get message text from all possible message types
        let text = '';
        if (msg.message?.conversation) {
            text = msg.message.conversation;
        } else if (msg.message?.extendedTextMessage?.text) {
            text = msg.message.extendedTextMessage.text;
        } else if (msg.message?.imageMessage?.caption) {
            text = msg.message.imageMessage.caption;
        } else if (msg.message?.videoMessage?.caption) {
            text = msg.message.videoMessage.caption;
        } else if (msg.message?.documentMessage?.caption) {
            text = msg.message.documentMessage.caption;
        } else if (msg.message?.buttonsResponseMessage?.selectedButtonId) {
            text = msg.message.buttonsResponseMessage.selectedButtonId;
        } else if (msg.message?.listResponseMessage?.title) {
            text = msg.message.listResponseMessage.title;
        }
        
        text = text.trim();
        
        // Check for prefix
        const prefix = process.env.BOT_PREFIX || '/';
        if (!text.startsWith(prefix)) return;
        
        const args = text.slice(prefix.length).split(' ').filter(arg => arg.length > 0);
        const command = args.shift()?.toLowerCase();
        
        if (!command) return;
        
        // Get or create player
        let player = GameEngine.getPlayer(phone);
        
        // Special commands that don't require account
        const noAccountCommands = ['start', 'register', 'help', 'menu', 'tutorial', 'ping', 'version'];
        if (!player && !noAccountCommands.includes(command)) {
            return sock.sendMessage(jid, { 
                text: `👋 Welcome! Please create an account first with:\n${prefix}start [your name]` 
            });
        }
        
        // Check maintenance mode
        if (process.env.MAINTENANCE_MODE === 'true' && !GameEngine.isAdmin(phone)) {
            return sock.sendMessage(jid, { 
                text: `🔧 ${process.env.MAINTENANCE_MESSAGE || 'Bot is under maintenance. Please try again later.'}` 
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
            
            await this.processCommand(sock, phone, jid, command, args, isGroup, player, msg);
            
            // Stop typing
            if (process.env.ENABLE_TYPING_INDICATOR === 'true') {
                await sock.sendPresenceUpdate('paused', jid);
            }
            
        } catch (err) {
            console.error('Command error:', err);
            await sock.sendMessage(jid, { text: '❌ An error occurred. Please try again.' });
            await sock.sendPresenceUpdate('paused', jid);
        }
    }
    
    static async processCommand(sock, phone, jid, command, args, isGroup, player, msg) {
        const config = global.gameConfig;
        const prefix = process.env.BOT_PREFIX || '/';
        
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
            case 'lb':
                if (config.features.leaderboard) {
                    await this.handleLeaderboard(sock, jid, args[0]);
                }
                break;
                
            case 'online':
                await this.handleOnline(sock, jid);
                break;
                
            case 'tutorial':
            case 'guide':
            case 'howto':
                await this.handleTutorial(sock, jid);
                break;
                
            case 'settings':
            case 'config':
                await this.handleSettings(sock, phone, jid, args);
                break;
                
            case 'inventory':
            case 'inv':
            case 'items':
            case 'bag':
                await this.handleInventory(sock, phone, jid);
                break;
                
            case 'use':
            case 'consume':
                await this.handleUseItem(sock, phone, jid, args);
                break;
                
            // ==================== BATTLE COMMANDS ====================
            case 'battle':
            case 'fight':
            case 'hunt':
                await PveSystem.startBattle(sock, phone, jid, args[0]);
                break;
                
            case 'attack':
            case 'atk':
            case 'hit':
                await PveSystem.attack(sock, phone, jid);
                break;
                
            case 'defend':
            case 'def':
            case 'block':
                await PveSystem.defend(sock, phone, jid);
                break;
                
            case 'heal':
            case 'recover':
                await PveSystem.heal(sock, phone, jid);
                break;
                
            case 'flee':
            case 'run':
            case 'escape':
                await PveSystem.flee(sock, phone, jid);
                break;
                
            case 'special':
            case 'ult':
            case 'ultimate':
            case 'skill':
                await PveSystem.special(sock, phone, jid);
                break;
                
            case 'status':
            case 'battlestatus':
            case 'check':
                await PveSystem.status(sock, phone, jid);
                break;
                
            // ==================== PVP COMMANDS ====================
            case 'ranked':
            case 'match':
            case 'queue':
                if (config.features.pvp) {
                    await PvpSystem.findMatch(sock, phone, jid);
                } else {
                    await sock.sendMessage(jid, { text: '❌ PvP is currently disabled.' });
                }
                break;
                
            case 'rank':
            case 'elo':
            case 'rating':
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
            case 'cancel':
                if (config.features.pvp) {
                    await PvpSystem.declineMatch(sock, phone, jid, args[0]);
                }
                break;
                
            case 'pvpstats':
            case 'pvplog':
            case 'history':
                if (config.features.pvp) {
                    await PvpSystem.showHistory(sock, phone, jid);
                }
                break;
                
            // ==================== ECONOMY COMMANDS ====================
            case 'bank':
            case 'vault':
                await BankSystem.handle(sock, phone, jid, args);
                break;
                
            case 'shop':
            case 'store':
            case 'market':
                if (config.features.shop) {
                    await ShopSystem.show(sock, jid, args[0]);
                }
                break;
                
            case 'buy':
            case 'purchase':
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
            case 'open':
                if (config.features.pets) {
                    await ShopSystem.crates(sock, phone, jid, args);
                }
                break;
                
            case 'listitem':
            case 'list':
                await ShopSystem.listItem(sock, phone, jid, args);
                break;
                
            case 'unlist':
            case 'delist':
                await ShopSystem.unlistItem(sock, phone, jid, args[0]);
                break;
                
            // ==================== PET COMMANDS ====================
            case 'pets':
            case 'pet':
            case 'companions':
                if (config.features.pets) {
                    await PetSystem.showPets(sock, phone, jid);
                }
                break;
                
            case 'petinfo':
            case 'petstats':
            case 'inspect':
                if (config.features.pets) {
                    await PetSystem.showPetInfo(sock, phone, jid, args[0]);
                }
                break;
                
            case 'equip':
            case 'equippet':
                if (config.features.pets) {
                    await PetSystem.equip(sock, phone, jid, args[0]);
                }
                break;
                
            case 'unequip':
            case 'removepet':
                if (config.features.pets) {
                    await PetSystem.unequip(sock, phone, jid);
                }
                break;
                
            case 'feed':
            case 'feedpet':
                if (config.features.pets) {
                    await PetSystem.feed(sock, phone, jid, args);
                }
                break;
                
            case 'train':
            case 'trainpet':
                if (config.features.pets) {
                    await PetSystem.train(sock, phone, jid, args);
                }
                break;
                
            case 'release':
            case 'abandon':
                if (config.features.pets) {
                    await PetSystem.release(sock, phone, jid, args);
                }
                break;
                
            case 'rename':
                if (config.features.pets) {
                    await PetSystem.rename(sock, phone, jid, args);
                }
                break;
                
            case 'favorite':
            case 'fav':
                if (config.features.pets) {
                    await PetSystem.favorite(sock, phone, jid, args[0]);
                }
                break;
                
            // ==================== TRADING COMMANDS ====================
            case 'trade':
            case 'offer':
                if (config.features.trading) {
                    await TradeSystem.request(sock, phone, jid, args);
                } else {
                    await sock.sendMessage(jid, { text: '❌ Trading is currently disabled.' });
                }
                break;
                
            case 'accepttrade':
            case 'confirmtrade':
                if (config.features.trading) {
                    await TradeSystem.accept(sock, phone, jid, args[0]);
                }
                break;
                
            case 'declinetrade':
            case 'canceltrade':
            case 'rejecttrade':
                if (config.features.trading) {
                    await TradeSystem.decline(sock, phone, jid, args[0]);
                }
                break;
                
            case 'trades':
            case 'offers':
            case 'pending':
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
            case 'mug':
                if (config.features.stealing) {
                    await StealSystem.handle(sock, phone, jid, args);
                } else {
                    await sock.sendMessage(jid, { text: '❌ Stealing is currently disabled.' });
                }
                break;
                
            case 'targets':
            case 'victims':
            case 'marks':
                if (config.features.stealing) {
                    await StealSystem.showTargets(sock, phone, jid);
                }
                break;
                
            case 'shield':
            case 'protect':
            case 'defense':
                await StealSystem.buyShield(sock, phone, jid);
                break;
                
            // ==================== GROUP BATTLE COMMANDS ====================
            case 'groupbattle':
            case 'raid':
            case 'gbattle':
            case 'graid':
                if (config.features.groupBattles && isGroup) {
                    await GroupBattleSystem.start(sock, phone, jid, args);
                } else if (!isGroup) {
                    await sock.sendMessage(jid, { text: '❌ Group battles can only be started in groups.' });
                } else {
                    await sock.sendMessage(jid, { text: '❌ Group battles are currently disabled.' });
                }
                break;
                
            case 'joingroup':
            case 'joinraid':
            case 'join':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.join(sock, phone, jid, args[0]);
                }
                break;
                
            case 'leavegroup':
            case 'leaveraid':
            case 'leave':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.leave(sock, phone, jid);
                }
                break;
                
            case 'gattack':
            case 'gatk':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.attack(sock, phone, jid);
                }
                break;
                
            case 'gheal':
            case 'ghelp':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.heal(sock, phone, jid, args[0]);
                }
                break;
                
            case 'gstatus':
            case 'ginfo':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.status(sock, jid);
                }
                break;
                
            case 'gstart':
                if (config.features.groupBattles) {
                    await GroupBattleSystem.forceStart(sock, phone, jid);
                }
                break;
                
            // ==================== WORLD BOSS COMMANDS ====================
            case 'boss':
            case 'worldboss':
            case 'wb':
                if (config.features.worldBosses) {
                    await WorldBossSystem.info(sock, jid);
                } else {
                    await sock.sendMessage(jid, { text: '❌ World bosses are currently disabled.' });
                }
                break;
                
            case 'bossattack':
            case 'batk':
            case 'battack':
                if (config.features.worldBosses) {
                    await WorldBossSystem.attack(sock, phone, jid);
                }
                break;
                
            case 'bossstatus':
            case 'bstatus':
                if (config.features.worldBosses) {
                    await WorldBossSystem.status(sock, jid);
                }
                break;
                
            case 'bossrewards':
            case 'brank':
            case 'bdamage':
                if (config.features.worldBosses) {
                    await WorldBossSystem.leaderboard(sock, jid);
                }
                break;
                
            case 'bosshistory':
                if (config.features.worldBosses) {
                    await WorldBossSystem.history(sock, jid);
                }
                break;
                
            // ==================== GUILD COMMANDS ====================
            case 'guild':
            case 'clan':
            case 'team':
                await GuildSystem.info(sock, phone, jid);
                break;
                
            case 'createguild':
            case 'newguild':
            case 'found':
                await GuildSystem.create(sock, phone, jid, args);
                break;
                
            case 'joinguild':
            case 'apply':
                await GuildSystem.join(sock, phone, jid, args[0]);
                break;
                
            case 'leaveguild':
            case 'quitguild':
                await GuildSystem.leave(sock, phone, jid);
                break;
                
            case 'guildmembers':
            case 'gmembers':
            case 'roster':
                await GuildSystem.members(sock, phone, jid);
                break;
                
            case 'guilddeposit':
            case 'gdeposit':
            case 'gd':
                await GuildSystem.deposit(sock, phone, jid, args[0]);
                break;
                
            case 'guildupgrade':
            case 'gupgrade':
            case 'gu':
                await GuildSystem.upgrade(sock, phone, jid);
                break;
                
            case 'guildkick':
            case 'gkick':
                await GuildSystem.kick(sock, phone, jid, args[0]);
                break;
                
            case 'guildpromote':
            case 'gpromote':
                await GuildSystem.promote(sock, phone, jid, args[0]);
                break;
                
            case 'guilddemote':
            case 'gdemote':
                await GuildSystem.demote(sock, phone, jid, args[0]);
                break;
                
            case 'guilds':
            case 'guildlist':
                await GuildSystem.list(sock, jid);
                break;
                
            // ==================== QUEST COMMANDS ====================
            case 'quests':
            case 'missions':
            case 'tasks':
                await QuestSystem.list(sock, phone, jid);
                break;
                
            case 'questinfo':
            case 'qinfo':
                await QuestSystem.info(sock, phone, jid, args[0]);
                break;
                
            case 'claimreward':
            case 'claim':
            case 'reward':
                await QuestSystem.claim(sock, phone, jid, args[0]);
                break;
                
            // ==================== SOCIAL COMMANDS ====================
            case 'msg':
            case 'message':
            case 'dm':
            case 'whisper':
                await this.handleMessageUser(sock, phone, jid, args);
                break;
                
            case 'inbox':
            case 'messages':
            case 'mail':
                await this.handleInbox(sock, phone, jid);
                break;
                
            case 'read':
            case 'readmsg':
                await this.handleReadMessage(sock, phone, jid, args[0]);
                break;
                
            case 'deletemsg':
            case 'delmsg':
                await this.handleDeleteMessage(sock, phone, jid, args[0]);
                break;
                
            case 'clearmessages':
            case 'clearmail':
            case 'clean':
                await this.handleClearMessages(sock, phone, jid);
                break;
                
            case 'gift':
            case 'give':
            case 'donate':
                await this.handleGift(sock, phone, jid, args);
                break;
                
            case 'pay':
                await this.handlePay(sock, phone, jid, args);
                break;
                
            // ==================== ACHIEVEMENT COMMANDS ====================
            case 'achievements':
            case 'ach':
            case 'trophies':
                await this.handleAchievements(sock, phone, jid);
                break;
                
            case 'titles':
            case 'badges':
                await this.handleTitles(sock, phone, jid);
                break;
                
            case 'equiptitle':
                await this.handleEquipTitle(sock, phone, jid, args[0]);
                break;
                
            // ==================== ADMIN COMMANDS ====================
            case 'admin':
            case 'adm':
                await AdminSystem.handle(sock, phone, jid, args);
                break;
                
            case 'broadcast':
            case 'bc':
            case 'announce':
                await AdminSystem.broadcast(sock, phone, args.join(' '));
                break;
                
            case 'givepoints':
            case 'addpoints':
            case 'gp':
                await AdminSystem.givePoints(sock, phone, args);
                break;
                
            case 'removepoints':
            case 'takepoints':
            case 'rp':
                await AdminSystem.removePoints(sock, phone, args);
                break;
                
            case 'setlevel':
            case 'setlvl':
                await AdminSystem.setLevel(sock, phone, args);
                break;
                
            case 'setexp':
                await AdminSystem.setExp(sock, phone, args);
                break;
                
            case 'ban':
            case 'suspend':
                await AdminSystem.ban(sock, phone, args);
                break;
                
            case 'unban':
            case 'unsuspend':
                await AdminSystem.unban(sock, phone, args);
                break;
                
            case 'mute':
            case 'silence':
                await AdminSystem.mute(sock, phone, args);
                break;
                
            case 'unmute':
            case 'unsilence':
                await AdminSystem.unmute(sock, phone, args);
                break;
                
            case 'spawnboss':
            case 'summon':
            case 'bossspawn':
                await AdminSystem.spawnBoss(sock, phone, args);
                break;
                
            case 'killboss':
            case 'endboss':
                await AdminSystem.killBoss(sock, phone, args);
                break;
                
            case 'maintenance':
            case 'maint':
                await AdminSystem.maintenance(sock, phone, args);
                break;
                
            case 'reload':
            case 'refresh':
                await AdminSystem.reloadConfig(sock, phone, jid);
                break;
                
            case 'backup':
                await AdminSystem.backup(sock, phone, jid);
                break;
                
            case 'restore':
                await AdminSystem.restore(sock, phone, args);
                break;
                
            case 'stats':
            case 'botstats':
            case 'info':
                await AdminSystem.stats(sock, phone, jid);
                break;
                
            case 'playerinfo':
            case 'pi':
                await AdminSystem.playerInfo(sock, phone, jid, args[0]);
                break;
                
            case 'eval':
            case 'execute':
                await AdminSystem.eval(sock, phone, jid, args);
                break;
                
            case 'sql':
            case 'query':
                await AdminSystem.sql(sock, phone, jid, args);
                break;
                
            // ==================== FUN/MISC COMMANDS ====================
            case 'roll':
            case 'dice':
                await this.handleRoll(sock, jid, args[0]);
                break;
                
            case 'flip':
            case 'coin':
                await this.handleCoinFlip(sock, jid);
                break;
                
            case 'rps':
            case 'rockpaperscissors':
                await this.handleRPS(sock, phone, jid, args[0]);
                break;
                
            case '8ball':
            case 'magicball':
                await this.handle8Ball(sock, jid, args.join(' '));
                break;
                
            case 'joke':
                await this.handleJoke(sock, jid);
                break;
                
            case 'fact':
                await this.handleFact(sock, jid);
                break;
                
            case 'quote':
                await this.handleQuote(sock, jid);
                break;
                
            case 'meme':
                await this.handleMeme(sock, jid);
                break;
                
            case 'ping':
                await sock.sendMessage(jid, { text: '🏓 Pong!' });
                break;
                
            case 'uptime':
                await this.handleUptime(sock, jid);
                break;
                
            case 'version':
            case 'v':
                await sock.sendMessage(jid, { 
                    text: `🎮 *${process.env.BOT_NAME}*\nVersion: 2.0.0\nEngine: Baileys\nDatabase: SQLite\nNode.js: ${process.version}` 
                });
                break;
                
            case 'report':
            case 'bug':
            case 'issue':
                await this.handleReport(sock, phone, jid, args);
                break;
                
            case 'suggest':
            case 'feedback':
            case 'idea':
                await this.handleSuggest(sock, phone, jid, args);
                break;
                
            case 'invite':
            case 'link':
                await this.handleInvite(sock, jid);
                break;
                
            case 'support':
            case 'helpdesk':
                await this.handleSupport(sock, jid);
                break;
                
            case 'donate':
            case 'premium':
                await this.handleDonate(sock, jid);
                break;
                
            default:
                await sock.sendMessage(jid, { 
                    text: `❓ Unknown command: *${command}*\n\nType ${prefix}menu for help.` 
                });
        }
    }
    
    // ==================== HANDLER METHODS ====================
    
    static async handleStart(sock, phone, jid, args) {
        const existing = GameEngine.getPlayer(phone);
        if (existing) {
            return sock.sendMessage(jid, { 
                text: `✅ You already have an account!\n\nName: ${existing.name}\nLevel: ${existing.level}\n\nUse /stats to see your profile.` 
            });
        }
        
        const name = args.join(' ').trim() || 'Player';
        if (name.length > 20) {
            return sock.sendMessage(jid, { text: '❌ Name too long (max 20 characters)' });
        }
        
        if (name.length < 2) {
            return sock.sendMessage(jid, { text: '❌ Name too short (min 2 characters)' });
        }
        
        // Check for inappropriate words
        const bannedWords = (process.env.BANNED_WORDS || '').split(',').filter(w => w);
        const lowerName = name.toLowerCase();
        for (const word of bannedWords) {
            if (lowerName.includes(word.toLowerCase())) {
                return sock.sendMessage(jid, { text: '❌ That name contains inappropriate language.' });
            }
        }
        
        const player = GameEngine.createPlayer(phone, name);
        const config = global.gameConfig;
        
        // Give starter pet
        if (config.features.pets) {
            const pet = GameEngine.givePet(phone, 'Common');
        }
        
        // Give starter items
        if (config.features.shop) {
            GameEngine.addItem(phone, 'consumable', 'Health Potion', 5);
            GameEngine.addItem(phone, 'consumable', 'Attack Boost', 2);
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
            (config.features.shop ? `• 5 Health Potions\n• 2 Attack Boosts\n` : '') +
            `\nType /menu to see all commands!\nType /tutorial to learn how to play.`;
            
        await sock.sendMessage(jid, { text });
        
        // Notify admin of new player
        const adminNumber = process.env.ADMIN_NUMBER;
        if (adminNumber && adminNumber !== phone) {
            await sock.sendMessage(Helpers.getJid(adminNumber), {
                text: `📢 New player joined!\nName: ${player.name}\nPhone: ${phone}`
            });
        }
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
        menu += `${prefix}tutorial - Game guide\n\n`;
        
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
        menu += `${prefix}inventory - Your items\n`;
        menu += `${prefix}use [item] - Use item\n\n`;
        
        if (config.features.pets) {
            menu += `*🐾 Pets:*\n`;
            menu += `${prefix}pets - View pets\n`;
            menu += `${prefix}equip [num] - Equip pet\n`;
            menu += `${prefix}feed [num] - Feed pet\n`;
            menu += `${prefix}train [num] - Train pet\n\n`;
        }
        
        if (config.features.trading) {
            menu += `*🔄 Trading:*\n`;
            menu += `${prefix}trade [phone] [points] - Request trade\n`;
            menu += `${prefix}trades - Pending trades\n\n`;
        }
        
        if (config.features.stealing) {
            menu += `*🦹 Stealing:*\n`;
            menu += `${prefix}steal [phone] - Steal points\n`;
            menu += `${prefix}targets - Show targets\n`;
            menu += `${prefix}shield - Buy protection\n\n`;
        }
        
        if (isGroup && config.features.groupBattles) {
            menu += `*👥 Group (Group only):*\n`;
            menu += `${prefix}groupbattle - Start raid\n`;
            menu += `${prefix}joingroup - Join raid\n`;
            menu += `${prefix}gattack - Attack boss\n\n`;
        }
        
        if (config.features.worldBosses) {
            menu += `*🐉 World Boss:*\n`;
            menu += `${prefix}boss - Current boss info\n`;
            menu += `${prefix}bossattack - Attack boss\n`;
            menu += `${prefix}bossrewards - Damage ranks\n\n`;
        }
        
        menu += `*💬 Social:*\n`;
        menu += `${prefix}msg [phone] [text] - Send message\n`;
        menu += `${prefix}inbox - Check messages\n`;
        menu += `${prefix}gift [phone] [amount] - Gift points\n\n`;
        
        menu += `Type ${prefix}help [command] for detailed info!`;
        
        await sock.sendMessage(jid, { text: menu });
    }
    
    static async handleStats(sock, phone, jid, targetPhone) {
        let target = phone;
        let isAdminView = false;
        
        if (targetPhone && GameEngine.isAdmin(phone)) {
            target = targetPhone.replace(/[^0-9]/g, '');
            isAdminView = true;
        }
        
        const player = GameEngine.getPlayer(target);
        if (!player) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        const config = global.gameConfig;
        const rank = Helpers.getRank(player.elo);
        const nextRank = Helpers.getNextRank(player.elo);
        const equipped = GameEngine.getEquippedPet(target);
        const petCount = GameEngine.getPlayerPets(target).length;
        
        // Calculate XP progress
        const currentLevelExp = Helpers.getRequiredExp(player.level);
        const nextLevelExp = Helpers.getRequiredExp(player.level + 1);
        const expInLevel = player.exp - currentLevelExp;
        const expNeeded = nextLevelExp - currentLevelExp;
        const percent = expNeeded > 0 ? Math.floor((expInLevel / expNeeded) * 100) : 100;
        
        let text = `📊 *${player.name}'s Profile* ${isAdminView ? '(Admin View)' : ''}\n\n`;
        
        // Level & Rank
        text += `📊 Level: ${player.level} (${Helpers.formatNumber(player.exp)} XP)\n`;
        text += `${Helpers.progressBar(expInLevel, expNeeded, 10)} ${percent}%\n`;
        text += `🏆 Rank: ${rank.icon} ${rank.name}`;
        if (nextRank) {
            text += ` (Next: ${nextRank.name} at ${nextRank.min} ELO)`;
        }
        text += `\n`;
        text += `⭐ ELO: ${Helpers.formatNumber(player.elo)}\n\n`;
        
        // Stats
        text += `*Stats:*\n`;
        text += `❤️ HP: ${player.hp}/${player.max_hp}\n`;
        text += `⚔️ Attack: ${player.attack}\n`;
        text += `🛡️ Defense: ${player.defense}\n`;
        text += `💨 Speed: ${player.speed}\n\n`;
        
        // Economy
        text += `*Economy:*\n`;
        text += `💰 Wallet: ${Helpers.formatNumber(player.points)}\n`;
        text += `🏦 Bank: ${Helpers.formatNumber(player.bank_points)} (Tier ${player.bank_tier})\n`;
        text += `📊 Total Earned: ${Helpers.formatNumber(player.total_earned || 0)}\n\n`;
        
        // PvP
        const totalGames = player.wins + player.losses;
        const winRate = totalGames > 0 ? Math.round((player.wins / totalGames) * 100) : 0;
        text += `*PvP Record:*\n`;
        text += `⚔️ ${player.wins}W / ${player.losses}L`;
        if (player.draws) text += ` / ${player.draws}D`;
        text += ` (${winRate}% WR)\n`;
        if (player.pvp_streak > 0) {
            text += `🔥 Win Streak: ${player.pvp_streak}\n`;
        }
        text += `\n`;
        
        // Pets
        if (config.features.pets) {
            text += `*Pets:* ${petCount}/${config.pets.maxPets}\n`;
            if (equipped) {
                text += `🐾 Equipped: ${equipped.name}\n`;
                text += `   ${equipped.rarity} Lv.${equipped.level}\n`;
                text += `   +${equipped.attack_bonus} ATK | +${equipped.defense_bonus} DEF\n`;
            }
            text += `\n`;
        }
        
        // Shield status
        if (player.shield_active && new Date(player.shield_expires) > new Date()) {
            const timeLeft = Helpers.formatTimeLeft(player.shield_expires);
            text += `🛡️ Shield: Active (${timeLeft})\n`;
        }
        
        // Active effects
        const effects = JSON.parse(player.active_effects || '{}');
        const activeEffects = Object.keys(effects).filter(k => effects[k] && (effects[k].duration > 0 || effects[k] > 0));
        if (activeEffects.length > 0) {
            text += `\n*Active Effects:*\n`;
            for (const effect of activeEffects) {
                const data = effects[effect];
                if (typeof data === 'object' && data.duration) {
                    text += `• ${effect}: ${data.duration} turns\n`;
                } else {
                    text += `• ${effect}: Active\n`;
                }
            }
        }
        
        text += `\n_Last active: ${new Date(player.last_active).toLocaleString()}_`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleDaily(sock, phone, jid) {
        const player = GameEngine.getPlayer(phone);
        const config = global.gameConfig;
        
        const lastDaily = new Date(player.last_daily || 0);
        const now = new Date();
        const hoursSince = (now - lastDaily) / (1000 * 60 * 60);
        
        if (hoursSince < 24) {
            const hoursLeft = Math.floor(24 - hoursSince);
            const minutesLeft = Math.floor((24 - hoursSince - hoursLeft) * 60);
            return sock.sendMessage(jid, { 
                text: `⏰ Daily reward available in ${hoursLeft}h ${minutesLeft}m\n\nCome back tomorrow!` 
            });
        }
        
        // Calculate streak
        let streak = player.daily_streak || 0;
        const daysSince = hoursSince / 24;
        
        if (daysSince < 2) {
            streak = Math.min(streak + 1, config.economy.maxStreak);
        } else {
            streak = 1; // Reset streak
        }
        
        // Calculate reward
        const base = config.economy.dailyBase;
        const levelBonus = player.level * config.economy.dailyPerLevel;
        const streakBonus = Math.floor(base * (streak - 1) * config.economy.streakMultiplier);
        const total = base + levelBonus + streakBonus;
        
        GameEngine.updatePlayer(phone, { 
            points: player.points + total,
            last_daily: now.toISOString(),
            daily_streak: streak
        });
        
        let text = `🎁 *Daily Reward!*\n\n`;
        text += `Base: ${Helpers.formatNumber(base)}\n`;
        text += `Level Bonus: ${Helpers.formatNumber(levelBonus)}\n`;
        if (streakBonus > 0) {
            text += `Streak Bonus (x${streak}): ${Helpers.formatNumber(streakBonus)}\n`;
        }
        text += `*Total: ${Helpers.formatNumber(total)} points*\n\n`;
        
        if (streak >= config.economy.maxStreak) {
            text += `🔥 Max streak reached! Amazing! 🎉\n`;
        } else {
            text += `Streak: ${streak}/${config.economy.maxStreak} days\n`;
            text += `Next streak bonus: ${Helpers.formatNumber(Math.floor(base * streak * config.economy.streakMultiplier))}\n`;
        }
        
        text += `\nCome back tomorrow!`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleLeaderboard(sock, jid, type = 'elo') {
        const validTypes = ['elo', 'level', 'points', 'pvp', 'wealth'];
        const sortType = validTypes.includes(type.toLowerCase()) ? type.toLowerCase() : 'elo';
        
        const top = GameEngine.getLeaderboard(sortType, 10);
        
        const titles = {
            elo: '🏆 Top Players by ELO',
            level: '📊 Top Players by Level',
            points: '💰 Richest Players',
            pvp: '⚔️ PvP Champions',
            wealth: '🏦 Top Bankers'
        };
        
        let text = `${titles[sortType]}\n\n`;
        
        top.forEach((p, i) => {
            const rank = Helpers.getRank(p.elo);
            const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`;
            
            switch(sortType) {
                case 'level':
                    text += `${medal} ${p.name} - Lv.${p.level} (${Helpers.formatNumber(p.exp)} XP)\n`;
                    break;
                case 'points':
                    const total = (p.points || 0) + (p.bank_points || 0);
                    text += `${medal} ${p.name} - ${Helpers.formatNumber(total)} pts\n`;
                    break;
                case 'pvp':
                    const wr = (p.wins + p.losses) > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0;
                    text += `${medal} ${p.name} - ${p.wins}W (${wr}% WR)\n`;
                    break;
                case 'wealth':
                    text += `${medal} ${p.name} - ${Helpers.formatNumber(p.bank_points || 0)} banked\n`;
                    break;
                case 'elo':
                default:
                    text += `${medal} ${rank.icon} ${p.name} - ${p.elo} ELO (Lv.${p.level})\n`;
            }
        });
        
        text += `\n_Type /leaderboard [${validTypes.join('|')}]_`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleOnline(sock, jid) {
        const db = Database.get();
        const online = db.prepare(`
            SELECT name, level, last_active 
            FROM players 
            WHERE last_active > datetime('now', '-5 minutes')
            AND banned = 0
            ORDER BY last_active DESC
            LIMIT 20
        `).all();
        
        if (online.length === 0) {
            return sock.sendMessage(jid, { text: 'No players online in the last 5 minutes.' });
        }
        
        let text = `🟢 *Online Players (${online.length})*\n\n`;
        online.forEach(p => {
            const timeAgo = Math.floor((Date.now() - new Date(p.last_active)) / 60000);
            text += `• ${p.name} (Lv.${p.level}) - ${timeAgo}m ago\n`;
        });
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleTutorial(sock, jid) {
        const prefix = process.env.BOT_PREFIX || '/';
        
        const text = `📚 *${process.env.BOT_NAME} - Tutorial*\n\n` +
            `*Getting Started:*\n` +
            `1. Create account: ${prefix}start YourName\n` +
            `2. Check stats: ${prefix}stats\n` +
            `3. Get daily reward: ${prefix}daily\n\n` +
            
            `*Battling:*\n` +
            `1. Start battle: ${prefix}battle\n` +
            `2. Choose action:\n` +
            `   ${prefix}attack - Deal damage\n` +
            `   ${prefix}defend - Reduce incoming damage\n` +
            `   ${prefix}heal - Restore HP\n` +
            `   ${prefix}flee - Try to escape\n` +
            `3. Win to get XP and points!\n\n` +
            
            `*Pets:*\n` +
            `• Open crates: ${prefix}crates Common\n` +
            `• View pets: ${prefix}pets\n` +
            `• Equip pet: ${prefix}equip 1\n` +
            `Pets boost your stats in battle!\n\n` +
            
            `*Economy:*\n` +
            `• Bank: ${prefix}bank\n` +
            `• Shop: ${prefix}shop\n` +
            `• Buy items: ${prefix}buy Health Potion\n\n` +
            
            `*Need more help?*\n` +
            `Type ${prefix}menu for all commands`;
            
        await sock.sendMessage(jid, { text });
    }
    
    static async handleSettings(sock, phone, jid, args) {
        const subcommand = args[0]?.toLowerCase();
        const db = Database.get();
        
        switch(subcommand) {
            case 'notifications':
            case 'notifs':
                const current = db.prepare('SELECT notifications FROM players WHERE phone = ?').get(phone).notifications;
                db.prepare('UPDATE players SET notifications = ? WHERE phone = ?').run(current ? 0 : 1, phone);
                await sock.sendMessage(jid, { text: `🔔 Notifications ${current ? 'disabled' : 'enabled'}` });
                break;
                
            case 'compact':
            case 'mode':
                const compact = db.prepare('SELECT compact_mode FROM players WHERE phone = ?').get(phone)?.compact_mode;
                db.prepare('UPDATE players SET compact_mode = ? WHERE phone = ?').run(compact ? 0 : 1, phone);
                await sock.sendMessage(jid, { text: `📱 Compact mode ${compact ? 'disabled' : 'enabled'}` });
                break;
                
            case 'language':
            case 'lang':
                await sock.sendMessage(jid, { text: 'Language settings coming soon!' });
                break;
                
            default:
                const settings = db.prepare('SELECT notifications, compact_mode, language FROM players WHERE phone = ?').get(phone);
                let text = `⚙️ *Your Settings*\n\n`;
                text += `Notifications: ${settings?.notifications ? '🔔 On' : '🔕 Off'}\n`;
                text += `Compact Mode: ${settings?.compact_mode ? '📱 On' : '📱 Off'}\n`;
                text += `Language: ${settings?.language || 'en'}\n\n`;
                text += `Change with:\n`;
                text += `${process.env.BOT_PREFIX}settings notifications\n`;
                text += `${process.env.BOT_PREFIX}settings compact`;
                await sock.sendMessage(jid, { text });
        }
    }
    
    static async handleInventory(sock, phone, jid) {
        const items = GameEngine.getInventory(phone);
        const player = GameEngine.getPlayer(phone);
        
        if (items.length === 0) {
            return sock.sendMessage(jid, { text: '🎒 Your inventory is empty.\nBuy items from /shop' });
        }
        
        let text = `🎒 *${player.name}'s Inventory*\n\n`;
        
        // Group by type
        const byType = {};
        items.forEach(item => {
            if (!byType[item.item_type]) byType[item.item_type] = [];
            byType[item.item_type].push(item);
        });
        
        for (const [type, typeItems] of Object.entries(byType)) {
            text += `*${Helpers.capitalize(type)}:*\n`;
            typeItems.forEach(item => {
                text += `• ${item.item_name} x${item.quantity}\n`;
            });
            text += `\n`;
        }
        
        text += `Use ${process.env.BOT_PREFIX}use [item name] to use an item`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleUseItem(sock, phone, jid, args) {
        const itemName = args.join(' ');
        if (!itemName) {
            return sock.sendMessage(jid, { text: `Usage: ${process.env.BOT_PREFIX}use [item name]` });
        }
        
        const result = GameEngine.useItem(phone, itemName);
        
        if (result.success) {
            await sock.sendMessage(jid, { text: `✅ ${result.message}` });
        } else {
            await sock.sendMessage(jid, { text: `❌ ${result.message}` });
        }
    }
    
    static async handleMessageUser(sock, phone, jid, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const message = args.slice(1).join(' ');
        
        if (!targetPhone || !message) {
            return sock.sendMessage(jid, { text: `Usage: ${process.env.BOT_PREFIX}msg [phone] [message]` });
        }
        
        if (!Helpers.isValidPhone(targetPhone)) {
            return sock.sendMessage(jid, { text: '❌ Invalid phone number' });
        }
        
        const target = GameEngine.getPlayer(targetPhone);
        if (!target) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        const sender = GameEngine.getPlayer(phone);
        
        // Check if sender is blocked by target
        // (Block system could be implemented here)
        
        GameEngine.sendMessage(targetPhone, phone, sender.name, `Message from ${sender.name}`, message, 'player');
        
        await sock.sendMessage(jid, { text: `📨 Message sent to ${target.name}` });
        
        // Notify receiver if online
        await sock.sendMessage(Helpers.getJid(targetPhone), {
            text: `📨 *New Message*\n\nFrom: ${sender.name}\n"${message}"\n\nReply with ${process.env.BOT_PREFIX}msg ${phone} [your message]`
        });
    }
    
    static async handleInbox(sock, phone, jid) {
        const messages = GameEngine.getMessages(phone, false);
        const unread = GameEngine.getUnreadCount(phone);
        
        if (messages.length === 0) {
            return sock.sendMessage(jid, { text: '📭 Your inbox is empty.' });
        }
        
        let text = `📬 *Inbox* (${unread} unread)\n\n`;
        
        messages.slice(0, 5).forEach((msg, i) => {
            const status = msg.read ? '✓' : '🔴';
            const preview = msg.content.substring(0, 30) + (msg.content.length > 30 ? '...' : '');
            text += `${status} ${i + 1}. ${msg.title || 'No subject'}\n`;
            text += `   From: ${msg.sender_name || 'System'}\n`;
            text += `   "${preview}"\n\n`;
        });
        
        if (messages.length > 5) {
            text += `_...and ${messages.length - 5} more_\n\n`;
        }
        
        text += `Read: ${process.env.BOT_PREFIX}read [number]\n`;
        text += `Delete: ${process.env.BOT_PREFIX}delmsg [number]`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleReadMessage(sock, phone, jid, msgNum) {
        const num = parseInt(msgNum);
        if (!num || num <= 0) {
            return sock.sendMessage(jid, { text: 'Usage: /read [message number]' });
        }
        
        const messages = GameEngine.getMessages(phone, false);
        if (num > messages.length) {
            return sock.sendMessage(jid, { text: '❌ Invalid message number' });
        }
        
        const msg = messages[num - 1];
        GameEngine.readMessage(msg.id, phone);
        
        let text = `📄 *${msg.title || 'Message'}*\n\n`;
        text += `From: ${msg.sender_name || 'System'}\n`;
        text += `Date: ${new Date(msg.created_at).toLocaleString()}\n\n`;
        text += `${msg.content}`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleDeleteMessage(sock, phone, jid, msgNum) {
        const num = parseInt(msgNum);
        if (!num) {
            return sock.sendMessage(jid, { text: 'Usage: /delmsg [number]' });
        }
        
        const messages = GameEngine.getMessages(phone, false);
        if (num > messages.length) {
            return sock.sendMessage(jid, { text: '❌ Invalid message number' });
        }
        
        GameEngine.deleteMessage(messages[num - 1].id, phone);
        await sock.sendMessage(jid, { text: '✅ Message deleted' });
    }
    
    static async handleClearMessages(sock, phone, jid) {
        GameEngine.clearInbox(phone);
        await sock.sendMessage(jid, { text: '✅ All messages cleared' });
    }
    
    static async handleGift(sock, phone, jid, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const amount = parseInt(args[1]);
        
        if (!targetPhone || !amount || amount <= 0) {
            return sock.sendMessage(jid, { text: `Usage: ${process.env.BOT_PREFIX}gift [phone] [amount]` });
        }
        
        const sender = GameEngine.getPlayer(phone);
        if (sender.points < amount) {
            return sock.sendMessage(jid, { text: '❌ Insufficient points' });
        }
        
        const target = GameEngine.getPlayer(targetPhone);
        if (!target) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        if (targetPhone === phone) {
            return sock.sendMessage(jid, { text: '❌ You cannot gift yourself' });
        }
        
        // Transfer
        GameEngine.addPoints(phone, -amount);
        GameEngine.addPoints(targetPhone, amount);
        
        await sock.sendMessage(jid, { 
            text: `🎁 Gifted ${Helpers.formatNumber(amount)} points to ${target.name}!` 
        });
        
        await sock.sendMessage(Helpers.getJid(targetPhone), {
            text: `🎁 *Gift Received!*\n\nFrom: ${sender.name}\nAmount: ${Helpers.formatNumber(amount)} points\n\nThank you!`
        });
    }
    
    static async handlePay(sock, phone, jid, args) {
        // Alias for gift
        await this.handleGift(sock, phone, jid, args);
    }
    
    static async handleAchievements(sock, phone, jid) {
        const db = Database.get();
        const achievements = db.prepare('SELECT * FROM achievements WHERE phone = ?').all(phone);
        
        if (achievements.length === 0) {
            return sock.sendMessage(jid, { text: '🏆 No achievements yet. Keep playing to unlock them!' });
        }
        
        let text = `🏆 *Your Achievements*\n\n`;
        achievements.forEach(ach => {
            const progress = ach.max_progress ? `${ach.progress}/${ach.max_progress}` : '✓';
            text += `${ach.unlocked_at ? '✅' : '⬜'} ${ach.name}\n`;
            text += `   ${ach.description} (${progress})\n`;
        });
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleTitles(sock, phone, jid) {
        const db = Database.get();
        const achievements = db.prepare(`
            SELECT * FROM achievements 
            WHERE phone = ? AND reward_claimed = 0 AND unlocked_at IS NOT NULL
        `).all(phone);
        
        if (achievements.length === 0) {
            return sock.sendMessage(jid, { text: '🎖️ No titles available. Complete achievements to earn titles!' });
        }
        
        let text = `🎖️ *Available Titles*\n\n`;
        achievements.forEach((ach, i) => {
            text += `${i + 1}. ${ach.name}\n`;
            text += `   Reward: Title "${ach.name}"\n`;
            text += `   ${process.env.BOT_PREFIX}claimreward ${ach.id}\n\n`;
        });
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleEquipTitle(sock, phone, jid, titleId) {
        // Implementation for equipping titles
        await sock.sendMessage(jid, { text: 'Title system coming soon!' });
    }
    
    // ==================== FUN COMMANDS ====================
    
    static async handleRoll(sock, jid, sides = '6') {
        const numSides = parseInt(sides) || 6;
        if (numSides < 1 || numSides > 1000) {
            return sock.sendMessage(jid, { text: '❌ Choose between 1-1000 sides' });
        }
        
        const result = Helpers.randomInt(1, numSides);
        await sock.sendMessage(jid, { text: `🎲 Rolled ${result} (1-${numSides})` });
    }
    
    static async handleCoinFlip(sock, jid) {
        const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
        const emoji = result === 'Heads' ? '👑' : '🪙';
        await sock.sendMessage(jid, { text: `${emoji} *${result}*` });
    }
    
    static async handleRPS(sock, phone, jid, choice) {
        const valid = ['rock', 'paper', 'scissors', 'r', 'p', 's'];
        if (!choice || !valid.includes(choice.toLowerCase())) {
            return sock.sendMessage(jid, { text: 'Choose: rock (r), paper (p), or scissors (s)' });
        }
        
        const moves = ['rock', 'paper', 'scissors'];
        const playerMove = choice.toLowerCase().charAt(0);
        const botMove = moves[Math.floor(Math.random() * 3)];
        
        const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
        
        let result;
        if (playerMove === botMove.charAt(0)) {
            result = 'Draw!';
        } else if (
            (playerMove === 'r' && botMove === 'scissors') ||
            (playerMove === 'p' && botMove === 'rock') ||
            (playerMove === 's' && botMove === 'paper')
        ) {
            result = 'You win! 🎉';
        } else {
            result = 'You lose! 💔';
        }
        
        await sock.sendMessage(jid, { 
            text: `You: ${emojis[moves.find(m => m.charAt(0) === playerMove)]}\nBot: ${emojis[botMove]}\n\n${result}` 
        });
    }
    
    static async handle8Ball(sock, jid, question) {
        if (!question) {
            return sock.sendMessage(jid, { text: 'Ask a question! /8ball Will I win?' });
        }
        
        const responses = [
            'It is certain.', 'It is decidedly so.', 'Without a doubt.',
            'Yes definitely.', 'You may rely on it.', 'As I see it, yes.',
            'Most likely.', 'Outlook good.', 'Yes.',
            'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
            'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
            'Don\'t count on it.', 'My reply is no.', 'My sources say no.',
            'Outlook not so good.', 'Very doubtful.'
        ];
        
        const response = responses[Math.floor(Math.random() * responses.length)];
        await sock.sendMessage(jid, { text: `🎱 *${response}*` });
    }
    
    static async handleJoke(sock, jid) {
        const jokes = [
            'Why don\'t scientists trust atoms? Because they make up everything!',
            'Why did the scarecrow win an award? He was outstanding in his field!',
            'Why don\'t eggs tell jokes? They\'d crack each other up!',
            'What do you call a fake noodle? An impasta!',
            'Why did the math book look sad? Because it had too many problems.'
        ];
        const joke = jokes[Math.floor(Math.random() * jokes.length)];
        await sock.sendMessage(jid, { text: `😄 ${joke}` });
    }
    
    static async handleFact(sock, jid) {
        const facts = [
            'Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old!',
            'Octopuses have three hearts, blue blood, and nine brains!',
            'Bananas are berries, but strawberries aren\'t!',
            'A day on Venus is longer than a year on Venus!',
            'Wombat poop is cube-shaped!'
        ];
        const fact = facts[Math.floor(Math.random() * facts.length)];
        await sock.sendMessage(jid, { text: `📚 Did you know? ${fact}` });
    }
    
    static async handleQuote(sock, jid) {
        const quotes = [
            '"The only way to do great work is to love what you do." - Steve Jobs',
            '"Innovation distinguishes between a leader and a follower." - Steve Jobs',
            '"Life is what happens when you\'re busy making other plans." - John Lennon',
            '"The future belongs to those who believe in the beauty of their dreams." - Eleanor Roosevelt'
        ];
        const quote = quotes[Math.floor(Math.random() * quotes.length)];
        await sock.sendMessage(jid, { text: `💭 ${quote}` });
    }
    
    static async handleMeme(sock, jid) {
        await sock.sendMessage(jid, { text: '🖼️ Meme feature coming soon! Send your own memes for now.' });
    }
    
    static async handleUptime(sock, jid) {
        const uptime = Date.now() - global.botStartTime;
        const seconds = Math.floor(uptime / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        let text = `⏱️ *Uptime*\n\n`;
        if (days > 0) text += `${days} days `;
        if (hours > 0) text += `${hours % 24} hours `;
        if (minutes > 0) text += `${minutes % 60} minutes `;
        text += `${seconds % 60} seconds`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async handleReport(sock, phone, jid, args) {
        const report = args.join(' ');
        if (!report) {
            return sock.sendMessage(jid, { text: 'Please describe the bug: /report [description]' });
        }
        
        const adminNumber = process.env.ADMIN_NUMBER;
        if (adminNumber) {
            const player = GameEngine.getPlayer(phone);
            await sock.sendMessage(Helpers.getJid(adminNumber), {
                text: `🐛 *Bug Report*\n\nFrom: ${player.name} (${phone})\n\n${report}`
            });
        }
        
        await sock.sendMessage(jid, { text: '✅ Report sent. Thank you for helping improve the bot!' });
    }
    
    static async handleSuggest(sock, phone, jid, args) {
        const suggestion = args.join(' ');
        if (!suggestion) {
            return sock.sendMessage(jid, { text: 'Please share your idea: /suggest [idea]' });
        }
        
        const adminNumber = process.env.ADMIN_NUMBER;
        if (adminNumber) {
            const player = GameEngine.getPlayer(phone);
            await sock.sendMessage(Helpers.getJid(adminNumber), {
                text: `💡 *Suggestion*\n\nFrom: ${player.name} (${phone})\n\n${suggestion}`
            });
        }
        
        await sock.sendMessage(jid, { text: '✅ Suggestion received. Thanks for your feedback!' });
    }
    
    static async handleInvite(sock, jid) {
        await sock.sendMessage(jid, { 
            text: `🤖 Invite ${process.env.BOT_NAME} to your group!\n\nShare this bot with friends and earn rewards when they join!` 
        });
    }
    
    static async handleSupport(sock, jid) {
        await sock.sendMessage(jid, { 
            text: `📞 *Support*\n\nNeed help? Contact the admin:\n${process.env.ADMIN_NUMBER || 'Not configured'}\n\nOr use /report to report bugs.` 
        });
    }
    
    static async handleDonate(sock, jid) {
        await sock.sendMessage(jid, { 
            text: `💝 *Support the Bot*\n\nYour donations help keep the bot running and fund new features!\n\nContact admin: ${process.env.ADMIN_NUMBER || 'Not configured'}` 
        });
    }
}

module.exports = MessageHandler;
