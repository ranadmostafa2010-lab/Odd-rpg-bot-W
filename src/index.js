'use strict';
require('dotenv').config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom }  = require('@hapi/boom');
const pino      = require('pino');
const path      = require('path');
const cron      = require('node-cron');

const { initDatabase, cleanExpired } = require('./core/database');
const { handleMessage }              = require('./handlers/messageHandler');
const R = require('./registry');

// Replit keep-alive
if (process.env.REPL_ID) {
  require('http').createServer((_, r) => r.end('ODD RPG alive!')).listen(process.env.PORT || 3000);
}

const SESSION = path.join(__dirname, '../session');

// ── Scheduled tasks ───────────────────────────────────────────
function startScheduler(sock) {
  // Bank interest daily at midnight
  cron.schedule('0 0 * * *', async () => {
    try { require('./systems/bankSystem').applyInterest(); } catch (e) { console.error(e.message); }
  });
  // Cleanup every 15 min
  cron.schedule('*/15 * * * *', async () => {
    try {
      cleanExpired();
      await require('./systems/auctionSystem').settleExpired(sock);
      await require('./systems/adminSystem').endExpiredGiveaways(sock);
    } catch (e) { console.error(e.message); }
  });
  // Weather change every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try { await require('./systems/weatherSystem').changeWeather(sock); } catch (e) {}
  });
  // World events every hour
  cron.schedule('0 * * * *', async () => {
    try { await require('./systems/worldEventSystem').fireEvent(sock); } catch (e) {}
  });
  // Mark offline players every 10 min
  cron.schedule('*/10 * * * *', () => {
    try { require('./core/database').db.prepare("UPDATE players SET offline_since=datetime('now') WHERE offline_since IS NULL AND last_login < datetime('now','-5 minutes') AND last_login IS NOT NULL").run(); } catch (e) {}
  });
  console.log('⏰ Scheduler running.');
}

// ── Connect ───────────────────────────────────────────────────
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version, auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['ODD RPG', 'Chrome', '1.0.0'],
    syncFullHistory: false, markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode : 0;
      console.log(`❌ Disconnected (${code})`);
      if (code !== DisconnectReason.loggedOut) setTimeout(connect, 5000);
    }
    if (connection === 'open') {
      console.log(`\n✅ ${R().game.bot.name} is ONLINE! Prefix: ${R().game.bot.prefix}\n`);
      startScheduler(sock);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue;
      if (m.key.remoteJid === 'status@broadcast') continue;
      const body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
      if (!body.startsWith(R().game.bot.prefix)) continue;
      await handleMessage(sock, m).catch(e => console.error('[msg]', e.message));
    }
  });
}

(async () => {
  console.log('🎮 Starting ODD RPG Bot V1.0 Re-Imagined...');
  initDatabase();
  await connect();
})().catch(console.error);
