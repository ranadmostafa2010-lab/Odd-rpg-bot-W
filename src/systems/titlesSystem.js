'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const TITLES = [
  { id: 'newbie', name: 'Newbie', emoji: '🌱', desc: 'Welcome to the game!', requirement: (p) => true },
  { id: 'fighter', name: 'Fighter', emoji: '⚔️', desc: 'Win 10 battles', requirement: (p) => p.pve_wins >= 10 },
  { id: 'warrior', name: 'Warrior', emoji: '🛡️', desc: 'Win 100 battles', requirement: (p) => p.pve_wins >= 100 },
  { id: 'champion', name: 'Champion', emoji: '👑', desc: 'Win 1,000 battles', requirement: (p) => p.pve_wins >= 1000 },
  { id: 'duelist', name: 'Duelist', emoji: '🤺', desc: 'Win 10 PvP matches', requirement: (p) => p.pvp_wins >= 10 },
  { id: 'gladiator', name: 'Gladiator', emoji: '🏆', desc: 'Win 100 PvP matches', requirement: (p) => p.pvp_wins >= 100 },
  { id: 'slayer', name: 'Slayer', emoji: '💀', desc: 'Defeat 50 bosses', requirement: (p) => p.bosses_killed >= 50 },
  { id: 'dragonslayer', name: 'Dragon Slayer', emoji: '🐉', desc: 'Defeat 200 bosses', requirement: (p) => p.bosses_killed >= 200 },
  { id: 'rich', name: 'Millionaire', emoji: '💰', desc: 'Have 1,000,000 Odds', requirement: (p) => p.odds >= 1000000 },
  { id: 'collector', name: 'Collector', emoji: '🐾', desc: 'Collect 20 pets', requirement: (p, db) => db.getPets(p.id).length >= 20 },
  { id: 'prestige1', name: 'Reborn', emoji: '🔄', desc: 'Reach Prestige 1', requirement: (p) => p.prestige >= 1 },
  { id: 'prestige5', name: 'Immortal', emoji: '✨', desc: 'Reach Prestige 5', requirement: (p) => p.prestige >= 5 },
  { id: 'guildleader', name: 'Guild Leader', emoji: '🏰', desc: 'Lead a guild', requirement: (p, db) => {
    const g = db.db.prepare('SELECT rank FROM guild_members WHERE player_id=?').get(p.id);
    return g?.rank === 'leader';
  }},
  { id: 'dungeonmaster', name: 'Dungeon Master', emoji: '🗝️', desc: 'Clear 20 dungeons', requirement: (p) => p.dungeons_cleared >= 20 },
  { id: 'legend', name: 'Legend', emoji: '🌟', desc: 'Reach Level 100', requirement: (p) => p.level >= 100 }
];

// ── Show titles ────────────────────────────────────────────────────
async function show(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const unlocked = DB.db.prepare('SELECT title_id FROM player_titles WHERE player_id=?').all(playerId).map(r => r.title_id);
  const equipped = player.title;
  
  let msg = `📛 *Titles*\n\n`;
  msg += `Equipped: ${equipped ? TITLES.find(t => t.id === equipped)?.emoji + ' ' + TITLES.find(t => t.id === equipped)?.name : 'None'}\n\n`;
  
  for (const title of TITLES) {
    const isUnlocked = unlocked.includes(title.id);
    const canUnlock = title.requirement(player, DB);
    const status = isUnlocked ? '✅' : canUnlock ? '🔓' : '🔒';
    
    msg += `${status} ${title.emoji} **${title.name}**\n`;
    msg += `_${title.desc}_\n`;
    
    if (isUnlocked && equipped !== title.id) {
      msg += `/title ${title.id} — Equip\n`;
    }
    msg += '\n';
  }
  
  await E.msg(sock, jid, msg);
}

// ── Equip title ────────────────────────────────────────────────────
async function equip(sock, jid, playerId, titleId) {
  if (!titleId) return E.msg(sock, jid, '❌ Usage: /title [title_id]');
  
  const unlocked = DB.db.prepare('SELECT 1 FROM player_titles WHERE player_id=? AND title_id=?').get(playerId, titleId);
  if (!unlocked) {
    // Check if they qualify
    const title = TITLES.find(t => t.id === titleId);
    if (!title) return E.msg(sock, jid, '❌ Title not found.');
    if (!title.requirement(DB.getPlayer(playerId), DB)) {
      return E.msg(sock, jid, `❌ You haven't unlocked **${title.name}** yet!`);
    }
    // Auto-unlock
    DB.db.prepare('INSERT INTO player_titles (player_id, title_id) VALUES (?,?)').run(playerId, titleId);
  }
  
  DB.updatePlayer(playerId, { title: titleId });
  const title = TITLES.find(t => t.id === titleId);
  
  await E.msg(sock, jid, `✅ Equipped title: ${title.emoji} **${title.name}**`);
}

// ── Check and auto-unlock titles ───────────────────────────────────
async function checkUnlocks(sock, playerId) {
  const player = DB.getPlayer(playerId);
  const unlocked = DB.db.prepare('SELECT title_id FROM player_titles WHERE player_id=?').all(playerId).map(r => r.title_id);
  
  for (const title of TITLES) {
    if (unlocked.includes(title.id)) continue;
    if (title.requirement(player, DB)) {
      DB.db.prepare('INSERT INTO player_titles (player_id, title_id) VALUES (?,?)').run(playerId, title.id);
      await E.msgPlayer(sock, playerId,
        `📛 *TITLE UNLOCKED!*\n\n` +
        `${title.emoji} **${title.name}**\n` +
        `_${title.desc}_\n\n` +
        `/titles — Equip it now!`
      ).catch(() => {});
    }
  }
}

module.exports = { show, equip, checkUnlocks };
