'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const { cleanNumber, cleanInt } = require('../core/security');

// ── Send trade offer ──────────────────────────────────────────
async function send(sock, jid, fromId, targetRaw, typeRaw, valueRaw) {
  const cfg = R().game.trading;
  const from = DB.getPlayer(fromId);
  
  // Check pending trades count
  const pending = DB.db.prepare("SELECT COUNT(*) as c FROM trades WHERE from_player=? AND status='pending'").get(fromId).c;
  if (pending >= cfg.max_pending) return E.msg(sock, jid, `❌ Max ${cfg.max_pending} pending trades. /trades to manage.`);
  
  const toId = cleanNumber(targetRaw);
  if (!toId) return E.msg(sock, jid, '❌ Invalid player number.');
  if (toId === fromId) return E.msg(sock, jid, '❌ Cannot trade with yourself!');
  
  const to = DB.getPlayer(toId);
  if (!to) return E.msg(sock, jid, '❌ Player not found.');
  
  const type = (typeRaw || '').toLowerCase();
  const expires = new Date(Date.now() + cfg.expire_minutes * 60000).toISOString();
  
  if (type === 'odds') {
    const amount = cleanInt(valueRaw, 1, from.odds);
    if (!amount) return E.msg(sock, jid, `❌ Invalid amount. You have ${E.fmt(from.odds)} 🪙.`);
    
    E.takeOdds(fromId, amount);
    DB.db.prepare('INSERT INTO trades (from_player, to_player, offer_type, offer_amount, expires_at) VALUES (?,?,?,?,?)')
      .run(fromId, toId, 'odds', amount, expires);
    
    await E.msg(sock, jid, `📨 Offered **${E.fmt(amount)} 🪙** to **${to.name}**.\nExpires in ${cfg.expire_minutes}m.`);
    await E.msgPlayer(sock, toId, `📨 **${from.name}** offers **${E.fmt(amount)} 🪙**!\n/accept or /decline`);
    
  } else if (type === 'pet') {
    const pets = DB.getPets(fromId);
    const slot = cleanInt(valueRaw, 1, pets.length);
    if (!slot) return E.msg(sock, jid, '❌ Invalid pet slot. /pets to check.');
    
    const petRow = pets[slot - 1];
    if (from.equipped_pet === petRow.pet_id) return E.msg(sock, jid, '❌ Unequip this pet first.');
    
    DB.removePet(fromId, petRow.pet_id);
    const petData = R.pet(petRow.pet_id);
    
    DB.db.prepare('INSERT INTO trades (from_player, to_player, offer_type, offer_item, expires_at) VALUES (?,?,?,?,?)')
      .run(fromId, toId, 'pet', petRow.pet_id, expires);
    
    await E.msg(sock, jid, `📨 Offered **${petData?.emoji} ${petData?.name}** to **${to.name}**.\nExpires in ${cfg.expire_minutes} **${to.name}**.\nExpires in ${cfg.expire_minutes}m.`);
    await E.msgPlayer(sock, toId, `📨 **${from.name}** offers pet **${petData?.emoji} ${petData?.name}**!\n/accept or /decline`);
    
  } else {
    await E.msg(sock, jid, '❌ Usage: /trade [number] odds [amount] OR /trade [number] pet [slot]');
  }
}

// ── Accept trade ───────────────────────────────────────────────
async function accept(sock, jid, playerId) {
  const trade = DB.db.prepare("SELECT * FROM trades WHERE to_player=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(playerId);
  if (!trade) return E.msg(sock, jid, '❌ No pending trade offers.');
  
  const from = DB.getPlayer(trade.from_player);
  const to = DB.getPlayer(playerId);
  
  // Fee calculation
  const cfg = R().game.trading;
  let fee = 0;
  let received = '';
  
  if (trade.offer_type === 'odds') {
    fee = Math.floor(trade.offer_amount * cfg.fee_pct / 100);
    const final = trade.offer_amount - fee;
    E.giveOdds(playerId, final);
    received = `${E.fmt(final)} 🪙 (fee: ${E.fmt(fee)})`;
  } else if (trade.offer_type === 'pet') {
    DB.addPet(playerId, trade.offer_item);
    const petData = R.pet(trade.offer_item);
    received = `${petData?.emoji} ${petData?.name}`;
    fee = 0; // No fee for pet trades
  }
  
  DB.db.prepare("UPDATE trades SET status='accepted' WHERE id=?").run(trade.id);
  
  await E.msg(sock, jid, `✅ Trade accepted! Received: **${received}**`);
  await E.msgPlayer(sock, trade.from_player, `✅ **${to.name}** accepted your trade! They received: ${received}`);
}

// ── Decline trade ───────────────────────────────────────────────
async function decline(sock, jid, playerId) {
  const trade = DB.db.prepare("SELECT * FROM trades WHERE to_player=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(playerId);
  if (!trade) return E.msg(sock, jid, '❌ No pending trade offers.');
  
  // Return items to sender
  if (trade.offer_type === 'odds') {
    E.giveOdds(trade.from_player, trade.offer_amount);
  } else if (trade.offer_type === 'pet') {
    DB.addPet(trade.from_player, trade.offer_item);
  }
  
  DB.db.prepare("UPDATE trades SET status='declined' WHERE id=?").run(trade.id);
  
  await E.msg(sock, jid, '❌ Trade declined.');
  await E.msgPlayer(sock, trade.from_player, `❌ **${DB.getPlayer(playerId)?.name}** declined your trade offer.`);
}

// ── List my trades ─────────────────────────────────────────────
async function list(sock, jid, playerId) {
  const sent = DB.db.prepare("SELECT * FROM trades WHERE from_player=? AND status='pending'").all(playerId);
  const received = DB.db.prepare("SELECT * FROM trades WHERE to_player=? AND status='pending'").all(playerId);
  
  let msg = `📋 *Your Trades*\n\n`;
  
  if (sent.length) {
    msg += `*Sent (${sent.length}):*\n`;
    for (const t of sent) {
      const to = DB.getPlayer(t.to_player);
      const item = t.offer_type === 'odds' ? `${E.fmt(t.offer_amount)} 🪙` : `${R.pet(t.offer_item)?.emoji} ${R.pet(t.offer_item)?.name}`;
      msg += `→ ${to?.name}: ${item} (expires soon)\n`;
    }
    msg += '\n';
  }
  
  if (received.length) {
    msg += `*Received (${received.length}):*\n`;
    for (const t of received) {
      const from = DB.getPlayer(t.from_player);
      const item = t.offer_type === 'odds' ? `${E.fmt(t.offer_amount)} 🪙` : `${R.pet(t.offer_item)?.emoji} ${R.pet(t.offer_item)?.name}`;
      msg += `← ${from?.name}: ${item}\n`;
    }
    msg += '\n/accept or /decline\n';
  }
  
  if (!sent.length && !received.length) {
    msg += `No active trades.\n\n/trade [number] odds [amount] — Send Odds\n/trade [number] pet [slot] — Send pet`;
  }
  
  await E.msg(sock, jid, msg);
}

module.exports = { send, accept, decline, list };
