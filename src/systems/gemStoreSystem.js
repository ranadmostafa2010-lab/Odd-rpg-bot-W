'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const { cleanText } = require('../core/security');

const PACKAGES = [
  { id: 'small', name: 'Gem Pouch', emoji: '💎', amount: 50, price: '$4.99', desc: '50 Gems' },
  { id: 'medium', name: 'Gem Satchel', emoji: '💎💎', amount: 120, price: '$9.99', desc: '120 Gems (+20 bonus)' },
  { id: 'large', name: 'Gem Chest', emoji: '💎💎💎', amount: 300, price: '$19.99', desc: '300 Gems (+50 bonus)' },
  { id: 'huge', name: 'Gem Hoard', emoji: '🌟', amount: 800, price: '$49.99', desc: '800 Gems (+150 bonus)' }
];

// ── Show store ─────────────────────────────────────────────────────
async function showStore(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  
  let msg = `💎 *Gem Store*\n\n`;
  msg += `Your Gems: **${player.gems}** 💎\n\n`;
  msg += `*Note:* This is a demo. In production, integrate payment processor.\n\n`;
  
  for (const pkg of PACKAGES) {
    msg += `${pkg.emoji} **${pkg.name}** — ${pkg.price}\n`;
    msg += `${pkg.desc}\n`;
    msg += `/buygems ${pkg.id} — Purchase\n\n`;
  }
  
  msg += `🎁 *Free Gems:*\n`;
  msg += `• /redeem [code] — Redeem voucher\n`;
  msg += `• Daily quests (/quest)\n`;
  msg += `• Achievements (/achievements)\n`;
  msg += `• Prestige rewards\n`;
  
  await E.msg(sock, jid, msg);
}

// ── Buy gems (demo - auto-grants) ───────────────────────────────────
async function buyGems(sock, jid, playerId, packageId) {
  const pkg = PACKAGES.find(p => p.id === packageId);
  if (!pkg) return E.msg(sock, jid, '❌ Package not found.');
  
  // In production: integrate Stripe/PayPal here
  // For demo: auto-grant
  
  E.giveGems(playerId, pkg.amount);
  
  await E.msg(sock, jid,
    `✅ **Purchase Complete!**\n\n` +
    `${pkg.emoji} **${pkg.name}**\n` +
    `+${pkg.amount} 💎 added!\n\n` +
    `Thank you for supporting ODD RPG!`
  );
}

// ── Redeem voucher code ─────────────────────────────────────────────
async function redeem(sock, jid, playerId, codeRaw) {
  if (!codeRaw) return E.msg(sock, jid, '❌ Usage: /redeem [code]');
  
  const code = cleanText(codeRaw, 20).toUpperCase();
  const voucher = DB.db.prepare('SELECT * FROM gem_vouchers WHERE code=?').get(code);
  
  if (!voucher) return E.msg(sock, jid, '❌ Invalid code.');
  if (voucher.redeemed_by) return E.msg(sock, jid, '❌ Code already redeemed!');
  if (new Date(voucher.expires_at) < new Date()) return E.msg(sock, jid, '❌ Code expired.');
  
  // Redeem
  DB.db.prepare('UPDATE gem_vouchers SET redeemed_by=?, redeemed_at=datetime("now") WHERE code=?').run(playerId, code);
  E.giveGems(playerId, voucher.gems);
  
  await E.msg(sock, jid, `🎁 **Code Redeemed!**\n\n+${voucher.gems} 💎 Gems added!`);
}

module.exports = { showStore, buyGems, redeem };
