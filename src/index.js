
main_index = """const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const cron = require('node-cron');
require('dotenv').config();

// Core imports
const Database = require('./core/database');
const GameEngine = require('./core/gameEngine');
const BattleManager = require('./core/battleManager');
const MessageHandler = require('./handlers/messageHandler');

// System imports
const PvESystem = require('./systems/pveSystem');
const PvPSystem = require('./systems/pvpSystem');
const GroupBattleSystem = require('./systems/groupBattleSystem');
const TradingSystem = require('./systems/tradingSystem');
const StealingSystem = require('./systems/stealingSystem');
const BankSystem = require('./systems/bankSystem');
const BossSystem = require('./systems/bossSystem');

const logger = pino({ level: 'silent' });

class OddRpgBot {
    constructor() {
        this.db = new Database();
        this.gameEngine = new GameEngine(this.db);
        this.battleManager = new BattleManager(this.db, this.gameEngine);
        
        // Initialize systems
        this.pveSystem = new PvESystem(this.db, this.gameEngine);
        this.pvpSystem = new PvPSystem(this.db, this.gameEngine);
        this.groupBattleSystem = new GroupBattleSystem(this.db, this.gameEngine);
        this.tradingSystem = new TradingSystem(this.db);
        this.stealingSystem = new StealingSystem(this.db, this.gameEngine);
        this.bankSystem = new BankSystem(this.db, this.gameEngine);
        this.bossSystem = new BossSystem(this.db, this.gameEngine);
        
        this.msgHandler = new MessageHandler(this);
        this.sock = null;
        this.qrRetry = 0;
        this.isShuttingDown = false;
    }

    async initialize() {
        console.log(chalk.cyan.bold('🎮 ODD RPG Bot v2.0 - Multiplayer Edition'));
        console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        // Initialize database
        await this.db.initialize();
        console.log(chalk.green('✅ Database initialized'));

        // Start background systems
        this.startBackgroundTasks();
        
        // Connect to WhatsApp
        await this.connectToWhatsApp();
    }

    async connectToWhatsApp() {
        const sessionPath = path.join(__dirname, '../session', process.env.SESSION_NAME || 'odd-rpg-session');
        await fs.ensureDir(sessionPath);
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        this.sock = makeWASocket({
            version,
            logger,
            printQRInTerminal: true,
            auth: state,
            browser: ['ODD RPG Bot', 'Desktop', '2.0.0'],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            getMessage: async () => undefined
        });

        // Connection events
        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(chalk.yellow('📱 Scan the QR code above with WhatsApp'));
                this.qrRetry++;
                if (this.qrRetry > 5) {
                    console.log(chalk.red('❌ QR code expired too many times. Restarting...'));
                    process.exit(1);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(chalk.red('❌ Connection closed due to:'), lastDisconnect?.error?.message);
                
                if (shouldReconnect && !this.isShuttingDown) {
                    console.log(chalk.yellow('🔄 Reconnecting in 5 seconds...'));
                    setTimeout(() => this.connectToWhatsApp(), 5000);
                } else {
                    console.log(chalk.red('❌ Logged out or shutdown. Please delete session folder and restart.'));
                    process.exit(1);
                }
            } else if (connection === 'open') {
                console.log(chalk.green('✅ Connected to WhatsApp!'));
                console.log(chalk.blue(`🤖 Bot: ${process.env.BOT_NAME || 'ODD RPG Bot'}`));
                console.log(chalk.blue(`👑 Admin: ${process.env.ADMIN_NUMBER}`));
                console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n'));
                this.qrRetry = 0;
                
                // Send startup message to admin
                await this.sendMessage(
                    `${process.env.ADMIN_NUMBER}@s.whatsapp.net`,
                    `🎮 *${process.env.BOT_NAME}* is now online!\\n\\n` +
                    `📊 Status: Operational\\n` +
                    `⏰ Started: ${new Date().toLocaleString()}\\n` +
                    `📱 Mode: Baileys/Termux\\n` +
                    `🎮 Version: 2.0 Multiplayer\\n\\n` +
                    `Use /menu to see commands.`
                );
            }
        });

        // Save credentials
        this.sock.ev.on('creds.update', saveCreds);

        // Handle messages
        this.sock.ev.on('messages.upsert', async (m) => {
            if (m.type === 'notify') {
                for (const msg of m.messages) {
                    if (!msg.key.fromMe && msg.message) {
                        await this.msgHandler.handleMessage(msg, this.sock);
                    }
                }
            }
        });

        // Handle presence updates
        this.sock.ev.on('presence.update', async (update) => {
            // Update player online status
            const phone = update.id?.replace(/@s.whatsapp.net/g, '');
            if (phone) {
                await this.db.updateStatus(phone, update.presence || 'offline');
            }
        });
    }

    async sendMessage(jid, text, options = {}) {
        try {
            if (process.env.TYPING_INDICATOR === 'true') {
                await this.sock.sendPresenceUpdate('composing', jid);
                await new Promise(r => setTimeout(r, 500));
            }
            
            const sent = await this.sock.sendMessage(jid, { 
                text: text,
                ...options
            });
            
            await this.sock.sendPresenceUpdate('paused', jid);
            return sent;
        } catch (error) {
            console.error(chalk.red('Error sending message:'), error.message);
        }
    }

    async editMessage(jid, messageId, newText) {
        try {
            await this.sock.sendMessage(jid, {
                text: newText,
                edit: messageId
            });
            return true;
        } catch (error) {
            console.error(chalk.yellow('Message edit failed, sending new message:'), error.message);
            return false;
        }
    }

    async sendButtonMessage(jid, text, buttons, options = {}) {
        try {
            const buttonMessage = {
                text: text,
                footer: options.footer || process.env.BOT_NAME,
                buttons: buttons.map(btn => ({
                    buttonId: btn.id,
                    buttonText: { displayText: btn.text },
                    type: 1
                })),
                headerType: 1
            };
            
            return await this.sock.sendMessage(jid, buttonMessage);
        } catch (error) {
            // Fallback to regular message if buttons fail
            console.log(chalk.yellow('⚠️  Buttons not supported, sending text fallback'));
            let fallbackText = text + '\\n\\n';
            buttons.forEach((btn, idx) => {
                fallbackText += `${idx + 1}. ${btn.text} (${btn.id})\\n`;
            });
            return await this.sendMessage(jid, fallbackText);
        }
    }

    async sendImageMessage(jid, imagePath, caption = '') {
        try {
            const buffer = await fs.readFile(imagePath);
            return await this.sock.sendMessage(jid, {
                image: buffer,
                caption: caption
            });
        } catch (error) {
            console.error(chalk.red('Error sending image:'), error.message);
            return await this.sendMessage(jid, caption);
        }
    }

    startBackgroundTasks() {
        // Daily bank interest at midnight
        cron.schedule('0 0 * * *', async () => {
            console.log(chalk.blue('🏦 Running daily bank interest...'));
            await this.bankSystem.processDailyInterest();
        });

        // Random boss spawn check every hour
        cron.schedule('0 * * * *', async () => {
            console.log(chalk.blue('👹 Checking for boss spawn...'));
            await this.bossSystem.trySpawnRandomBoss(this);
        });

        // Database backup every 6 hours
        cron.schedule('0 */6 * * *', async () => {
            console.log(chalk.blue('💾 Running database backup...'));
            await this.db.backup();
        });

        // Clean up old sessions weekly
        cron.schedule('0 0 * * 0', async () => {
            console.log(chalk.blue('🧹 Cleaning up old sessions...'));
            await this.cleanupSessions();
        });

        console.log(chalk.green('✅ Background tasks scheduled'));
    }

    async cleanupSessions() {
        const sessionPath = path.join(__dirname, '../session');
        const maxAge = parseInt(process.env.MAX_SESSION_AGE_DAYS) || 7;
        const cutoff = Date.now() - (maxAge * 24 * 60 * 60 * 1000);

        try {
            const files = await fs.readdir(sessionPath);
            for (const file of files) {
                const filePath = path.join(sessionPath, file);
                const stats = await fs.stat(filePath);
                if (stats.mtimeMs < cutoff) {
                    await fs.remove(filePath);
                    console.log(chalk.yellow(`🗑️  Removed old session: ${file}`));
                }
            }
        } catch (error) {
            console.error(chalk.red('Error cleaning sessions:'), error.message);
        }
    }

    async shutdown() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;
        
        console.log(chalk.yellow('\\n🛑 Shutting down gracefully...'));
        
        // Notify admin
        try {
            await this.sendMessage(
                `${process.env.ADMIN_NUMBER}@s.whatsapp.net`,
                `🛑 Bot is shutting down...\\n${new Date().toLocaleString()}`
            );
        } catch (e) {}

        // Close database
        await this.db.close();
        
        console.log(chalk.green('✅ Shutdown complete'));
        process.exit(0);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    if (global.bot) await global.bot.shutdown();
});

process.on('SIGTERM', async () => {
    if (global.bot) await global.bot.shutdown();
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error(chalk.red('Uncaught Exception:'), error);
    if (global.bot) global.bot.shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Rejection at:'), promise, 'reason:', reason);
});

// Start bot
(async () => {
    try {
        global.bot = new OddRpgBot();
        await global.bot.initialize();
    } catch (error) {
        console.error(chalk.red('Fatal error:'), error);
        process.exit(1);
    }
})();

module.exports = OddRpgBot;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/index.js', 'w') as f:
    f.write(main_index)

print("✅ 16. src/index.js created")