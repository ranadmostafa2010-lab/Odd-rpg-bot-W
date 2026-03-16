'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const ACHIEVEMENTS = [
  { id: 'first_blood', name: 'First Blood', desc: 'Win your first battle', check: (p) => p.pve_wins >= 1, reward_odds: 100, reward_gems: 0 },
  { id: 'veteran', name: 'Veteran', desc: 'Win 100 battles', check: (p) => p.pve_wins >= 100, reward_odds: 5000, reward_gems: 5 },
  { id: 'warrior', name: 'Warrior', desc: 'Win 1,000 battles', check: (p) => p.pve_wins >= 1000, reward_odds: 50000, reward_gems: 50 },
  { id: 'duelist', name: 'Duelist', desc: 'Win your first PvP match', check: (p) => p.pvp_wins >= 1, reward_odds: 500, reward_gems: 2 },
  { id: 'gladiator', name: 'Gladiator', desc: 'Win 50 PvP matches', check: (p) => p.pvp_wins >= 50, reward_odds: 10000, reward_gems: 20 },
  { id: 'boss_slayer', name: 'Boss Slayer', desc: 'Defeat 10 bosses', check: (p) => p.bosses_killed >= 10, reward_odds: 10000, reward_gems: 10 },
  { id: 'dragon_slayer', name: 'Dragon Slayer', desc: 'Defeat 100 bosses', check: (p) => p.bosses_killed >= 100, reward_odds: 100000, reward_gems: 100 },
  { id: 'rich', name: 'Getting Rich', desc: 'Have 100,000 Odds', check: (p) => p.odds >= 100000, reward_odds: 0, reward_gems: 10 },
  { id: 'wealthy', name: 'Wealthy', desc: 'Have 1,000,000 Odds', check: (p) => p.odds >= 1000000, reward_odds: 0, reward_gems: 50 },
  { id: 'collector', name: 'Pet Collector', desc: 'Collect 10 different pets', check: (p, db) => db.getPets(p.id).length >= 10, reward_odds: 5000, reward_gems: 10 },
  { id: 'guild_master', name: 'Guild Master', desc: 'Create or join a guild', check: (p, db) => !!db.db.prepare('SELECT 1 FROM guild_members WHERE player_id=?').get(p.id), reward_odds: 2000, reward_gems: 5 },
  { id: 'dungeon_crawler', name: 'Dungeon Crawler', desc: 'Clear 5 dungeons', check: (p) => p.dungeons_cleared >= 5, reward_odds: 10000, reward_gems: 15 },
  { id: 'prestige_1', name: 'Reborn', desc: 'Reach Prestige 1', check: (p) => p.prestige >= 1, reward_odds: 0, reward_gems: 100 },
  { id: 'max_level', name: 'Max Level', desc: 'Reach Level 50', check: (p) => p.level >= 50, reward_odds: 50000, reward_gems: 50 }
];

// ── Show achievements ───────────────────────────────────────────
async function show(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const unlocked = DB.db.prepare('SELECT achievement_id FROM player_achievements WHERE player_id=?').all(playerId).map(r => r.achievement_id);
  
  let msg = `🏆 *Achievements*\n\n`;
  msg += `Unlocked: **${unlocked.length}** / ${ACHIEVEMENTS.length}\n\n`;
  
  for (const ach of ACHIEVEMENTS) {
    const isUnlocked = unlocked.includes(ach.id);
    const icon = isUnlocked ? '✅' : '⬜';
    msg += `${icon} **${ach.name}**\n`;
    msg += `_${ach.desc}_\n`;
    if (isUnlocked) {
      msg += `Reward: ${ach.reward_odds > 0 ? E.fmt(ach.reward_odds) + ' 🪙 ' : ''}${ach.reward_gems > 0 ? ach.reward_gems + ' 💎' : ''}\n`;
    }
    msg += '\n';
  }
  
  await E.msg(sock, jid, msg);
}

// ── Check and award ─────────────────────────────────────────────
async function check(sock, playerId) {
  const player = DB.getPlayer(playerId);
  const unlocked = DB.db.prepare('SELECT achievement_id FROM player_achievements WHERE player_id=?').all(playerId).map(r => r.achievement_id);
  
  for (const ach of ACHIEVEMENTS) {
    if (unlocked.includes(ach.id)) continue;
    if (ach.check(player, DB)) {
      // Award
      DB.db.prepare('INSERT INTO player_achievements (player_id, achievement_id) VALUES (?,?)').run(playerId, ach.id);
      if (ach.reward_odds > 0) E.giveOdds(playerId, ach.reward_odds);
      if (ach.reward_gems > 0) E.giveGems(playerId, ach.reward_gems);
      
      await E.msgPlayer(sock, playerId,
        `🏆 *ACHIEVEMENT UNLOCKED!*\n\n` +
        `**${ach.name}**\n` +
        `_${ach.desc}_\n\n` +
        (ach.reward_odds > 0 ? `🪙 +${E.fmt(ach.reward_odds)} ` : '') +
        (ach.reward_gems > 0 ? `💎 +${ach.reward_gems}` : '')
      ).catch(() => {});
    }
  }
}

module.exports = { show, check };
