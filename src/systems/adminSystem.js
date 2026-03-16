'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const { cleanNumber, cleanInt, cleanText } = require('../core/security');

// ── Check if admin ────────────────────────────────────────────
function isAdmin(playerId) {
  const cfg = R().admin;
  const admin = cfg.admins.find(a => a.number === playerId);
  return admin || null;
}

function hasPermission(playerId, perm) {
  const admin = isAdmin(playerId);
  if (!admin) return false;
  const perms = cfg.permissions[admin.level] || {};
  return perms[perm] || false;
}

// ── Main admin handler ────────────────────────────────────────
async function handle(sock, jid, playerId, args) {
  const admin = isAdmin(playerId);
  if (!admin) return E.msg(sock, jid, '❌ Admin access denied.');
  
  const cmd = (args[0] || '').toLowerCase();
  
  switch(cmd) {
    case 'giveodds':  return giveOdds(sock, jid, playerId, args[1], args[2]);
    case 'givegems':  return giveGems(sock, jid, playerId, args[1], args[2]);
    case 'givepet':   return givePet(sock, jid, playerId, args[1], args[2]);
    case 'ban':       return banPlayer(sock, jid, playerId, args[1], args.slice(2).join(' '));
    case 'unban':     return unbanPlayer(sock, jid, playerId, args[1]);
    case 'broadcast': return broadcast(sock, jid, playerId, args.slice(1).join(' '));
    case 'maintenance': return toggleMaintenance(sock, jid, playerId);
    case 'giveaway':  return startGiveaway(sock, jid, playerId, args[1], args[2]);
    case 'spawnraid': return spawnRaid(sock, jid, playerId, args[1]);
    case 'genkeys':   return genGemKeys(sock, jid, playerId, args[1], args[2]);
    case 'reset':     return resetPlayer(sock, jid, playerId, args[1]);
    case 'stats':     return showStats(sock, jid, playerId);
    default:
      await E.msg(sock, jid, 
        `🔧 *Admin Commands*\n\n` +
        `giveodds [num] [amount]\n` +
        `givegems [num] [amount]\n` +
        `givepet [num] [pet_id]\n` +
        `ban [num] [reason]\n` +
        `unban [num]\n` +
        `broadcast [message]\n` +
        `maintenance — Toggle mode\n` +
        `giveaway [odds/gems] [amount]\n` +
        `spawnraid [boss_id]\n` +
        `genkeys [amount] [gems_each]\n` +
        `reset [num] — Wipe player\n` +
        `stats — Bot statistics`
      );
  }
}

// ── Give Odds ─────────────────────────────────────────────────
async function giveOdds(sock, jid, adminId, targetRaw, amountStr) {
  if (!hasPermission(adminId, 'can_give_odds')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const targetId = cleanNumber(targetRaw);
  const amount = cleanInt(amountStr, 1, 999999999);
  if (!targetId || !amount) return E.msg(sock, jid, '❌ Usage: /admin giveodds [number] [amount]');
  
  const target = DB.getPlayer(targetId);
  if (!target) return E.msg(sock, jid, '❌ Player not found.');
  
  E.giveOdds(targetId, amount);
  DB.logAdmin(adminId, 'give_odds', targetId, amount);
  
  await E.msg(sock, jid, `✅ Gave **${E.fmt(amount)} 🪙** to **${target.name}**`);
  await E.msgPlayer(sock, targetId, `🎁 **Admin Gift!** +${E.fmt(amount)} 🪙`);
}

// ── Give Gems ─────────────────────────────────────────────────
async function giveGems(sock, jid, adminId, targetRaw, amountStr) {
  if (!hasPermission(adminId, 'can_give_gems')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const targetId = cleanNumber(targetRaw);
  const amount = cleanInt(amountStr, 1, 999999);
  if (!targetId || !amount) return E.msg(sock, jid, '❌ Usage: /admin givegems [number] [amount]');
  
  const target = DB.getPlayer(targetId);
  if (!target) return E.msg(sock, jid, '❌ Player not found.');
  
  E.giveGems(targetId, amount);
  DB.logAdmin(adminId, 'give_gems', targetId, amount);
  
  await E.msg(sock, jid, `✅ Gave **${amount} 💎** to **${target.name}**`);
  await E.msgPlayer(sock, targetId, `🎁 **Admin Gift!** +${amount} 💎`);
}

// ── Give Pet ──────────────────────────────────────────────────
async function givePet(sock, jid, adminId, targetRaw, petId) {
  if (!hasPermission(adminId, 'can_give_pets')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const targetId = cleanNumber(targetRaw);
  if (!targetId || !petId) return E.msg(sock, jid, '❌ Usage: /admin givepet [number] [pet_id]');
  
  const target = DB.getPlayer(targetId);
  if (!target) return E.msg(sock, jid, '❌ Player not found.');
  
  const pet = R.pet(petId);
  if (!pet) return E.msg(sock, jid, `❌ Pet "${petId}" not found.`);
  
  DB.addPet(targetId, petId);
  DB.logAdmin(adminId, 'give_pet', targetId, petId);
  
  await E.msg(sock, jid, `✅ Gave **${pet.emoji} ${pet.name}** to **${target.name}**`);
  await E.msgPlayer(sock, targetId, `🎁 **Admin Gift!** You received ${pet.emoji} **${pet.name}**!`);
}

// ── Ban/Unban ─────────────────────────────────────────────────
async function banPlayer(sock, jid, adminId, targetRaw, reason) {
  if (!hasPermission(adminId, 'can_ban_players')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const targetId = cleanNumber(targetRaw);
  if (!targetId) return E.msg(sock, jid, '❌ Usage: /admin ban [number] [reason]');
  
  const target = DB.getPlayer(targetId);
  if (!target) return E.msg(sock, jid, '❌ Player not found.');
  
  DB.updatePlayer(targetId, { 
    is_banned: 1, 
    ban_reason: cleanText(reason, 100) || 'No reason given',
    ban_expires: null // Permanent
  });
  DB.logAdmin(adminId, 'ban', targetId, reason);
  
  await E.msg(sock, jid, `🚫 **${target.name}** has been banned.`);
}

async function unbanPlayer(sock, jid, adminId, targetRaw) {
  if (!hasPermission(adminId, 'can_ban_players')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const targetId = cleanNumber(targetRaw);
  if (!targetId) return E.msg(sock, jid, '❌ Usage: /admin unban [number]');
  
  DB.updatePlayer(targetId, { is_banned: 0, ban_reason: null, ban_expires: null });
  DB.logAdmin(adminId, 'unban', targetId);
  
  await E.msg(sock, jid, `✅ Player unbanned.`);
}

// ── Broadcast ───────────────────────────────────────────────────
async function broadcast(sock, jid, adminId, message) {
  if (!hasPermission(adminId, 'can_broadcast')) return E.msg(sock, jid, '❌ Permission denied.');
  if (!message) return E.msg(sock, jid, '❌ Usage: /admin broadcast [message]');
  
  const players = DB.db.prepare("SELECT id FROM players WHERE is_banned=0").all();
  const cleanMsg = cleanText(message, 500);
  
  for (const p of players) {
    await E.msgPlayer(sock, p.id, `📢 *ADMIN BROADCAST*\n\n${cleanMsg}`).catch(() => {});
  }
  
  DB.logAdmin(adminId, 'broadcast', null, cleanMsg);
  await E.msg(sock, jid, `📢 Broadcast sent to ${players.length} players.`);
}

// ── Maintenance mode ────────────────────────────────────────────
async function toggleMaintenance(sock, jid, adminId) {
  if (!hasPermission(adminId, 'can_toggle_maintenance')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const cfg = R();
  const newMode = !cfg.game.bot.maintenance_mode;
  cfg.game.bot.maintenance_mode = newMode;
  R.saveConfig('game_config.json', cfg.game);
  
  DB.logAdmin(adminId, 'maintenance', null, newMode ? 'ON' : 'OFF');
  await E.msg(sock, jid, `🔧 Maintenance mode: **${newMode ? 'ON' : 'OFF'}**`);
}

// ── Giveaway ────────────────────────────────────────────────────
async function startGiveaway(sock, jid, adminId, typeRaw, amountStr) {
  if (!hasPermission(adminId, 'can_start_giveaway')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const type = (typeRaw || '').toLowerCase();
  const amount = cleanInt(amountStr, 1, 999999999);
  if (!['odds','gems'].includes(type) || !amount) {
    return E.msg(sock, jid, '❌ Usage: /admin giveaway [odds/gems] [amount]');
  }
  
  const endsAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour
  
  const gid = DB.db.prepare('INSERT INTO giveaways (prize_type, prize_amount, ends_at, created_by) VALUES (?,?,?,?)')
    .run(type, amount, endsAt, adminId).lastInsertRowid;
  
  const players = DB.db.prepare("SELECT id FROM players WHERE is_banned=0 AND last_login > datetime('now','-7 days')").all();
  for (const p of players) {
    await E.msgPlayer(sock, p.id, 
      `🎉 *GIVEAWAY STARTED!*\n\n` +
      `Prize: **${E.fmt(amount)} ${type === 'odds' ? '🪙' : '💎'}**\n` +
      `Ends in **1 hour**!\n\n` +
      `/enter — Join now!`
    ).catch(() => {});
  }
  
  DB.logAdmin(adminId, 'giveaway', null, `${amount} ${type}`);
  await E.msg(sock, jid, `🎉 Giveaway #${gid} started! ${players.length} players notified.`);
}

// ── End expired giveaways (called by scheduler) ─────────────────
async function endExpiredGiveaways(sock) {
  const expired = DB.db.prepare("SELECT * FROM giveaways WHERE status='active' AND ends_at <= datetime('now')").all();
  
  for (const g of expired) {
    const entries = JSON.parse(g.entries || '[]');
    if (entries.length === 0) {
      DB.db.prepare("UPDATE giveaways SET status='ended' WHERE id=?").run(g.id);
      continue;
    }
    
    const winnerId = entries[Math.floor(Math.random() * entries.length)];
    
    if (g.prize_type === 'odds') E.giveOdds(winnerId, g.prize_amount);
    else E.giveGems(winnerId, g.prize_amount);
    
    DB.db.prepare("UPDATE giveaways SET status='complete' WHERE id=?").run(g.id);
    
    const winner = DB.getPlayer(winnerId);
    for (const entry of entries) {
      if (entry === winnerId) {
        await E.msgPlayer(sock, entry, 
          `🏆 *YOU WON!*\n\n` +
          `Giveaway prize: **${E.fmt(g.prize_amount)} ${g.prize_type === 'odds' ? '🪙' : '💎'}**!\n` +
          `Congratulations!`
        ).catch(() => {});
      } else {
        await E.msgPlayer(sock, entry, 
          `🎉 Giveaway ended!\n\nWinner: **${winner?.name || 'Unknown'}**\nBetter luck next time!`
        ).catch(() => {});
      }
    }
  }
}

// ── Spawn raid ───────────────────────────────────────────────────
async function spawnRaid(sock, jid, adminId, bossId) {
  if (!hasPermission(adminId, 'can_spawn_boss')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const RAID = require('./raidSystem');
  await RAID.spawnRaid(sock, bossId || 'ancient_titan');
  DB.logAdmin(adminId, 'spawn_raid', null, bossId || 'ancient_titan');
  await E.msg(sock, jid, '✅ Raid boss spawned!');
}

// ── Generate gem keys ──────────────────────────────────────────
async function genGemKeys(sock, jid, adminId, countStr, gemsStr) {
  if (!hasPermission(adminId, 'can_gen_gemcodes')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const count = cleanInt(countStr, 1, 100);
  const gems = cleanInt(gemsStr, 1, 1000);
  if (!count || !gems) return E.msg(sock, jid, '❌ Usage: /admin genkeys [count] [gems_each]');
  
  const keys = [];
  const expires = new Date(Date.now() + 7 * 86400000).toISOString(); // 7 days
  
  for (let i = 0; i < count; i++) {
    const code = 'GEM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    DB.db.prepare('INSERT INTO gem_vouchers (code, gems, created_by, expires_at) VALUES (?,?,?,?)')
      .run(code, gems, adminId, expires);
    keys.push(code);
  }
  
  DB.logAdmin(adminId, 'gen_keys', null, `${count} keys, ${gems} gems each`);
  await E.msg(sock, jid, `✅ Generated **${count}** gem keys (${gems} 💎 each):\n\n${keys.join('\n')}`);
}

// ── Reset player ─────────────────────────────────────────────────
async function resetPlayer(sock, jid, adminId, targetRaw) {
  if (!hasPermission(adminId, 'can_reset_player')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const targetId = cleanNumber(targetRaw);
  if (!targetId) return E.msg(sock, jid, '❌ Usage: /admin reset [number]');
  
  const target = DB.getPlayer(targetId);
  if (!target) return E.msg(sock, jid, '❌ Player not found.');
  
  // Wipe all data
  DB.db.prepare('DELETE FROM player_pets WHERE player_id=?').run(targetId);
  DB.db.prepare('DELETE FROM inventory WHERE player_id=?').run(targetId);
  DB.db.prepare('DELETE FROM materials WHERE player_id=?').run(targetId);
  DB.db.prepare('DELETE FROM player_skills WHERE player_id=?').run(targetId);
  DB.db.prepare('DELETE FROM player_achievements WHERE player_id=?').run(targetId);
  DB.db.prepare('DELETE FROM player_titles WHERE player_id=?').run(targetId);
  DB.db.prepare('DELETE FROM player_quests WHERE player_id=?').run(targetId);
  DB.db.prepare('DELETE FROM guild_members WHERE player_id=?').run(targetId);
  DB.db.prepare('DELETE FROM active_battles WHERE player_id=?').run(targetId);
  
  // Reset player row
  const cfg = R().game.new_player;
  DB.updatePlayer(targetId, {
    level: 1, xp: 0, hp: cfg.starting_max_hp, max_hp: cfg.starting_max_hp,
    attack: cfg.starting_attack, defense: cfg.starting_defense,
    odds: cfg.starting_odds, gems: cfg.starting_gems,
    bank_balance: 0, bank_tier: 1, elo: 1000,
    pvp_wins: 0, pvp_losses: 0, pve_wins: 0, bosses_killed: 0,
    dungeons_cleared: 0, total_odds_earned: 0, steal_successes: 0,
    class: null, skill_points: 0, prestige: 0, prestige_badge: null,
    equipped_pet: null, title: null, story_world: 'forest', story_chapter: 1,
    worlds_cleared: 0, daily_streak: 0
  });
  
  // Give starter stuff
  DB.addPet(targetId, cfg.starter_pet);
  DB.updatePlayer(targetId, { equipped_pet: cfg.starter_pet });
  
  DB.logAdmin(adminId, 'reset_player', targetId);
  await E.msg(sock, jid, `🔄 **${target.name}** has been completely reset.`);
}

// ── Bot stats ───────────────────────────────────────────────────
async function showStats(sock, jid, adminId) {
  if (!hasPermission(adminId, 'can_view_dashboard')) return E.msg(sock, jid, '❌ Permission denied.');
  
  const stats = DB.db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM players) as total_players,
      (SELECT COUNT(*) FROM players WHERE last_login > datetime('now','-24 hours')) as active_24h,
      (SELECT COUNT(*) FROM players WHERE last_login > datetime('now','-7 days')) as active_7d,
      (SELECT SUM(odds) FROM players) as total_odds,
      (SELECT SUM(gems) FROM players) as total_gems,
      (SELECT COUNT(*) FROM active_battles) as active_battles,
      (SELECT COUNT(*) FROM guilds) as total_guilds,
      (SELECT COUNT(*) FROM auctions WHERE status='active') as active_auctions
  `).get();
  
  await E.msg(sock, jid,
    `📊 *Bot Statistics*\n\n` +
    `👥 Total Players: **${E.fmt(stats.total_players)}**\n` +
    `🟢 Active (24h): **${stats.active_24h}**\n` +
    `🟡 Active (7d): **${stats.active_7d}**\n\n` +
    `💰 Total Odds: **${E.fmt(stats.total_odds)}**\n` +
    `💎 Total Gems: **${E.fmt(stats.total_gems)}**\n\n` +
    `⚔️ Active Battles: **${stats.active_battles}**\n` +
    `🏰 Guilds: **${stats.total_guilds}**\n` +
    `🏪 Active Auctions: **${stats.active_auctions}**`
  );
}

module.exports = { handle, isAdmin, hasPermission, endExpiredGiveaways };
