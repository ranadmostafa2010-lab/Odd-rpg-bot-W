const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const chalk = require('chalk');
const fs = require('fs-extra');
const readline = require('readline');
const path = require('path');
require('dotenv').config();

const Database = require('./core/database');
const MessageHandler = require('./handler/messageHandler');
const GameLoop = require('./core/gameLoop');
const ConfigLoader = require('./core/configLoader');

const logger = pino({ 
    level: process.env.LOG_LEVEL || 'info',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true }
    }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Global state
global.sock = null;
global.botStartTime = Date.now();

async function connectToWhatsApp() {
    const sessionPath = path.join('./session', process.env.SESSION_NAME || 'odd-rpg-session');
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    logger.info(`Using Baileys v${version.join('.')}, isLatest: ${isLatest}`);
    
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        browser: [process.env.BOT_NAME || 'ODD RPG Bot', 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: true,
        syncFullHistory: true,
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        msgRetryCounterMap: {},
        shouldIgnoreJid: (jid) => {
            const isGroup = jid.endsWith('@g.us');
            const isBroadcast = jid.endsWith('@broadcast');
            const isStatus = jid === 'status@broadcast';
            return isStatus;
        },
        getMessage: async (key) => {
            // Implement message store if needed
            return { conversation: 'hello' };
        }
    });

    global.sock = sock;

    // Pairing Code Authentication
    if (!sock.authState.creds.registered) {
        console.log(chalk.cyan('\n╔════════════════════════════════════════╗'));
        console.log(chalk.cyan('║     PAIRING CODE AUTHENTICATION        ║'));
        console.log(chalk.cyan('╚════════════════════════════════════════╝\n'));
        
        const phoneNumber = await question(chalk.yellow('[?] Enter your WhatsApp number (with country code, e.g., 201061479235): '));
        
        if (!phoneNumber || phoneNumber.length < 10) {
            console.log(chalk.red('[!] Invalid phone number'));
            process.exit(1);
        }
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(chalk.green('\n[✓] Your pairing code: ') + chalk.bold.bgWhite.black(` ${code} `));
                console.log(chalk.cyan('\n[i] Instructions:'));
                console.log('   1. Open WhatsApp on your phone');
                console.log('   2. Go to Settings → Linked Devices');
                console.log('   3. Tap "Link a Device" → "Link with phone number"');
                console.log('   4. Enter the code above\n');
            } catch (err) {
                console.log(chalk.red('[!] Failed to generate pairing code:', err.message));
                process.exit(1);
            }
        }, 3000);
    }

    // Connection Events
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (connection === 'connecting') {
            console.log(chalk.yellow('[i] Connecting to WhatsApp...'));
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            logger.error('Connection closed:', { statusCode, error: lastDisconnect?.error?.message });
            
            if (statusCode === DisconnectReason.loggedOut) {
                console.log(chalk.red('[!] Logged out. Please delete session folder and restart.'));
                process.exit(0);
            }
            
            if (shouldReconnect) {
                console.log(chalk.yellow('[i] Reconnecting in 5 seconds...'));
                setTimeout(connectToWhatsApp, 5000);
            }
        }
        
        if (connection === 'open') {
            console.log(chalk.green('\n[✓] Connected to WhatsApp!'));
            console.log(chalk.cyan(`[i] Bot Number: ${sock.user.id.split(':')[0]}`));
            console.log(chalk.cyan(`[i] Name: ${sock.user.name}\n`));
            
            // Initialize systems
            try {
                Database.init();
                ConfigLoader.load();
                GameLoop.start(sock);
                
                // Send startup message to admin
                const adminNumber = process.env.ADMIN_NUMBER;
                if (adminNumber) {
                    const adminJid = adminNumber + '@s.whatsapp.net';
                    const startupMsg = `🎮 *${process.env.BOT_NAME}* is now online!\\n\\n` +
                        `✅ Version: 2.0.0\\n` +
                        `✅ Database: Connected\\n` +
                        `✅ Game Systems: Active\\n` +
                        `📅 ${new Date().toLocaleString()}`;
                    
                    await sock.sendMessage(adminJid, { text: startupMsg });
                }
                
                console.log(chalk.green('[✓] All systems operational\n'));
                
            } catch (err) {
                logger.error('Initialization error:', err);
                console.log(chalk.red('[!] Failed to initialize systems:', err.message));
            }
        }
    });

    // Message Handler
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        
        for (const msg of m.messages) {
            if (msg.key.fromMe) continue;
            if (!msg.message) continue;
            
            try {
                await MessageHandler.handle(sock, msg);
            } catch (err) {
                logger.error('Message handling error:', err);
            }
        }
    });

    // Group Events
    sock.ev.on('groups.upsert', async (groups) => {
        logger.info('New groups:', groups);
    });
    
    sock.ev.on('group-participants.update', async (update) => {
        logger.info('Group participants update:', update);
    });

    return sock;
}

// Graceful Shutdown
process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n[!] Shutting down gracefully...'));
    if (global.sock) {
        await global.sock.sendPresenceUpdate('unavailable');
    }
    Database.close();
    rl.close();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start
console.log(chalk.cyan(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║           🎮 ODD RPG Bot v2.0 🎮                 ║
║                                                  ║
║     WhatsApp RPG Bot - Baileys Edition           ║
║     Pairing Code Authentication                  ║
║                                                  ║
╚══════════════════════════════════════════════════╝
`));

connectToWhatsApp().catch(err => {
    logger.error('Fatal error:', err);
    console.error(chalk.red('[!] Fatal error:', err.message));
    process.exit(1);
});
