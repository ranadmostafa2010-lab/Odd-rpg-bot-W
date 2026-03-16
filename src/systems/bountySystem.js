'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const { cleanNumber, cleanInt } = require('../core/security');

const BOUNTY_DURATION = 48 * 3600000; // 48 hours

// ── Post a bounty ──────────────────────────────────────────────────
async function post(sock, jid, playerId, targetRaw, amountStr) {
  const player = DB.getPlayer(playerId);
  
  const targetId = cleanNumber(targetRaw);
  if (!targetId) return E.msg(sock, jid, '❌ Usage: /bounty [player_number] [amount]');
  if (targetId === playerId) return E.msg(sock, jid, '❌ Cannot bounty yourself!');
  
  const target = DB.getPlayer(targetId);
  if (!target) return E.msg(sock, jid, '❌ Target not found.');
  
  const amount = cleanInt(amountStr, 1000, player.odds);
  if (!amount) return E.msg(sock, jid, `❌ Invalid amount. Min: 1,000 🪙`);
  
  // Check existing bounty on target
  const existing = DB.db.prepare("SELECT 1 FROM bounties WHERE target_id=? AND status='active'").get(targetId);
  if (existing) return E.msg(sock, jid, '❌ There is already an active bounty on this player!');
  
  E.takeOdds(playerId, amount);
  const expires = new Date(Date.now() + BOUNTY_DURATION).toISOString();
  
  DB.db.prepare('INSERT INTO bounties (target_id, poster_id, amount_odds, expires_at) VALUES (?,?,?,?)')
    .run(targetId, playerId, amount, expires);
  
  await E.msg(sock, jid, `🎯 **Bounty Posted!**\n\nTarget: **${target.name}**\nReward: **${E.fmt(amount)} 🪙**\nDuration: 48 hours\n\nDefeat them in PvP to claim!`);
  
  // Notify target
  await E.msgPlayer(sock, targetId, `🚨 **BOUNTY ALERT!**\n\nSomeone placed a **${E.fmt(amount)} 🪙** bounty on your head!\nWatch your back...`).catch(() => {});
  
  // Notify online players
  const online = DB.db.prepare("SELECT id FROM players WHERE last_login > datetime('now','-10 minutes') AND id != ? AND id != ?").get(playerId, targetId);
  for (const o of online) {
    await E.msgPlayer(sock, o.id, `🎯 New Bounty! **${target.name}** — ${E.fmt(amount)} 🪙 reward! /bounties`).catch(() => {});
  }
}

// ── Show bounty board ──────────────────────────────────────────────
async function board(sock, jid, playerId) {
  const bounties = DB.db.prepare(`
    SELECT b.*, p.name as target_name, p.elo as target_elo, poster.name as poster_name 
    FROM bounties b 
    JOIN players p ON b.target_id = p.id 
    JOIN players poster ON b.poster_id = poster.id
    WHERE b.status='active' AND b.expires_at > datetime('now')
  `).all();
  
  if (!bounties.length) return E.msg(sock, jid, '🎯 No active bounties. /bounty to post one!');
  
  let msg = `🎯 *Bounty Board*\n\n`;
  
  for (const b of bounties) {
    const rank = E.getEloRank(b.target_elo);
    const hoursLeft = Math.ceil((new Date(b.expires_at) - Date.now()) / 3600000);
    
    msg += `💰 **${E.fmt(b.amount_odds)} 🪙**\n`;
    msg += `Target: **${b.target_name}** ${rank.emoji} (ELO: ${b.target_elo})\n`;
    msg += `Posted by: ${b.poster_name}\n`;
    msg += `Expires: ${hoursLeft}h | /mybounty if this is you\n\n`;
  }
  
  await E.msg(sock, jid, msg);
}

// ── Check my bounty ─────────────────────────────────────────────────
async function mine(sock, jid, playerId) {
  const bounty = DB.db.prepare("SELECT * FROM bounties WHERE target_id=? AND status='active'").get(playerId);
  
  if (!bounty) {
    // Check if they claimed any
    const claimed = DB.db.prepare("SELECT * FROM bounties WHERE claimed_by=? ORDER BY created_at DESC LIMIT 5").all(playerId);
    if (!claimed.length) return E.msg(sock, jid, '🎯 No active bounty on you. Stay low!');
    
    let msg = `💰 *Your Bounty Claims*\n\n`;
    for (const c of claimed) {
      const target = DB.getPlayer(c.target_id);
      msg += `✅ ${E.fmt(c.amount_odds)} 🪙 from **${target?.name || 'Unknown'}**\n`;
    }
    return E.msg(sock, jid, msg);
  }
  
  const poster = DB.getPlayer(bounty.poster_id);
  const hoursLeft = Math.ceil((new Date(bounty.expires_at) - Date.now()) / 3600000);
  
  await E.msg(sock, jid,
    `🚨 **BOUNTY ON YOUR HEAD!**\n\n` +
    `💰 Reward: **${E.fmt(bounty.amount_odds)} 🪙**\n` +
    `Posted by: **${poster?.name || 'Unknown'}**\n` +
    `Expires: **${hoursLeft} hours**\n\n` +
    `⚠️ Win PvP matches to stay alive!\n` +
    `The hunter becomes the hunted if you defeat your pursuers...`
  );
}

// ── Claim bounty (called by PvP system) ────────────────────────────
async function checkClaim(sock, winnerId, loserId) {
  const bounty = DB.db.prepare("SELECT * FROM bounties WHERE target_id=? AND status='active'").get(loserId);
  if (!bounty) return;
  
  // Update bounty
  DB.db.prepare("UPDATE bounties SET status='claimed', claimed_by=? WHERE id=?").run(winnerId, bounty.id);
  
  // Pay winner
  E.giveOdds(winnerId, bounty.amount_odds);
  
  // Notify
  const winner = DB.getPlayer(winnerId);
  const loser = DB.getPlayer(loserId);
  
  await E.msgPlayer(sock, winnerId,
    `🎯 **BOUNTY CLAIMED!**\n\n` +
    `You defeated **${loser?.name}** and claimed the bounty!\n` +
    `💰 +${E.fmt(bounty.amount_odds)} 🪙`
  ).catch(() => {});
  
  await E.msgPlayer(sock, bounty.poster_id,
    `✅ **Bounty Completed!**\n\n` +
    `**${winner?.name}** has defeated **${loser?.name}**!\n` +
    `Your ${E.fmt(bounty.amount_odds)} 🪙 bounty was claimed.`
  ).catch(() => {});
}

module.exports = { post, board, mine, checkClaim };
