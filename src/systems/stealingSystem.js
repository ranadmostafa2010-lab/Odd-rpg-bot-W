'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const { cleanNumber } = require('../core/security');

// ── List steal targets ──────────────────────────────────────────
async function listTargets(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const cfg = R().game.stealing;
  
  const cd = E.cdLeft(player.last_steal, cfg.cooldown_minutes);
  if (cd > 0) return E.msg(sock, jid, `⏳ Steal cooldown: **${cd}m** remaining.`);
  
  // Find targets: online, no shield, similar level, have money
  const targets = DB.db.prepare(`
    SELECT id, name, level, odds, elo FROM players 
    WHERE id != ? 
    AND is_banned = 0 
    AND last_login > datetime('now', '-10 minutes')
    AND (shield_expires IS NULL OR shield_expires < datetime('now'))
    AND odds > 100
    AND level BETWEEN ? AND ?
    ORDER BY odds DESC
    LIMIT 5
  `).all(playerId, player.level - 5, player.level + 5);
  
  if (!targets.length) return E.msg(sock, jid, '❌ No valid targets right now. Try again later!');
  
  let msg = `🎯 *Steal Targets*\n\n`;
  msg += `Success chance: **${cfg.success_chance_pct}%**\n`;
  msg += `Max steal: **${cfg.max_steal_pct}%** of target's Odds\n\n`;
  
  for (const t of targets) {
    const rank = E.getEloRank(t.elo);
    msg += `• **${t.name}** (Lv.${t.level}) ${rank.emoji}\n`;
    msg += `  🪙 ${E.fmt(t.odds)} | /steal ${t.id}\n`;
  }
  
  msg += `\n⚠️ Failed steals cost **${E.fmt(cfg.fail_penalty)} 🪙**!`;
  await E.msg(sock, jid, msg);
}

// ── Attempt steal ───────────────────────────────────────────────
async function steal(sock, jid, playerId, targetRaw) {
  const player = DB.getPlayer(playerId);
  const cfg = R().game.stealing;
  
  const cd = E.cdLeft(player.last_steal, cfg.cooldown_minutes);
  if (cd > 0) return E.msg(sock, jid, `⏳ Steal cooldown: **${cd}m** remaining.`);
  
  const targetId = cleanNumber(targetRaw);
  if (!targetId) return E.msg(sock, jid, '❌ Invalid target number.');
  if (targetId === playerId) return E.msg(sock, jid, '❌ Cannot steal from yourself!');
  
  const target = DB.getPlayer(targetId);
  if (!target) return E.msg(sock, jid, '❌ Target not found.');
  
  // Validation checks
  if (target.odds < 100) return E.msg(sock, jid, '❌ Target is broke!');
  if (target.shield_expires && new Date(target.shield_expires) > new Date()) {
    return E.msg(sock, jid, `🛡️ **${target.name}** is shielded! Steal blocked.`);
  }
  if (Math.abs(player.level - target.level) > 5) {
    return E.msg(sock, jid, '❌ Target level too different (±5 levels max).');
  }
  
  // Attempt
  const success = Math.random() * 100 < cfg.success_chance_pct;
  DB.updatePlayer(playerId, { last_steal: new Date().toISOString() });
  
  if (success) {
    const amount = Math.floor(target.odds * cfg.max_steal_pct / 100);
    E.takeOdds(targetId, amount);
    E.giveOdds(playerId, amount);
    DB.updatePlayer(playerId, { steal_successes: (player.steal_successes || 0) + 1 });
    
    await E.msg(sock, jid, 
      `🎭 **STEAL SUCCESS!**\n\n` +
      `Stole **${E.fmt(amount)} 🪙** from **${target.name}**!`
    );
    await E.msgPlayer(sock, targetId, `🚨 **${player.name}** stole **${E.fmt(amount)} 🪙** from you! Get a shield: /shop`);
  } else {
    E.takeOdds(playerId, cfg.fail_penalty);
    await E.msg(sock, jid, 
      `🚔 **CAUGHT!**\n\n` +
      `You failed to steal from **${target.name}**!\n` +
      `Penalty: **${E.fmt(cfg.fail_penalty)} 🪙**\n` +
      `Success rate: ${cfg.success_chance_pct}% — try again later!`
    );
  }
}

module.exports = { listTargets, steal };
