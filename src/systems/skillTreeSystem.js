'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const SKILLS = {
  hp_boost:     { name: 'Vitality',      emoji: '❤️',  desc: '+5% Max HP per level',        max: 10, cost: 1 },
  atk_boost:    { name: 'Power',         emoji: '⚔️',  desc: '+3% Attack per level',        max: 10, cost: 1 },
  def_boost:    { name: 'Armor',         emoji: '🛡️',  desc: '+3% Defense per level',       max: 10, cost: 1 },
  crit_boost:   { name: 'Precision',     emoji: '🎯',  desc: '+1% Crit Chance per level',   max: 10, cost: 1 },
  loot_boost:   { name: 'Fortune',       emoji: '💰',  desc: '+5% Odds from battles',       max: 5,  cost: 2 },
  xp_boost:     { name: 'Wisdom',        emoji: '📚',  desc: '+5% XP from battles',         max: 5,  cost: 2 },
  heal_boost:   { name: 'Restoration',   emoji: '💚',  desc: '+10% Heal effectiveness',     max: 5,  cost: 2 },
  pet_boost:    { name: 'Bond',          emoji: '🐾',  desc: '+10% Pet special damage',       max: 5,  cost: 2 }
};

// ── Show skill tree ────────────────────────────────────────────
async function showSkills(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const mySkills = DB.db.prepare('SELECT * FROM player_skills WHERE player_id=?').all(playerId);
  const skillMap = {};
  mySkills.forEach(s => skillMap[s.skill_id] = s.level);
  
  let msg = `📚 *Skill Tree*\n\n`;
  msg += `Available Points: **${player.skill_points}**\n\n`;
  
  for (const [id, s] of Object.entries(SKILLS)) {
    const level = skillMap[id] || 0;
    const maxed = level >= s.max ? ' ✅' : '';
    msg += `${s.emoji} **${s.name}** (${level}/${s.max})${maxed}\n`;
    msg += `_${s.desc}_ — Cost: ${s.cost} pt${s.cost > 1 ? 's' : ''}\n`;
    if (level < s.max && player.skill_points >= s.cost) {
      msg += `/skillup ${id} — Upgrade!\n`;
    }
    msg += '\n';
  }
  
  msg += `/skillreset — Reset all (costs 100 💎)`;
  await E.msg(sock, jid, msg);
}

// ── Level up skill ─────────────────────────────────────────────
async function levelUp(sock, jid, playerId, skillId) {
  if (!skillId || !SKILLS[skillId]) return E.msg(sock, jid, '❌ Invalid skill. /skills to see options.');
  
  const player = DB.getPlayer(playerId);
  const skill = SKILLS[skillId];
  
  const current = DB.db.prepare('SELECT level FROM player_skills WHERE player_id=? AND skill_id=?').get(playerId, skillId);
  const currentLevel = current?.level || 0;
  
  if (currentLevel >= skill.max) return E.msg(sock, jid, `❌ **${skill.name}** is already maxed!`);
  if (player.skill_points < skill.cost) return E.msg(sock, jid, `❌ Need ${skill.cost} skill point(s). Have ${player.skill_points}.`);
  
  // Deduct points and save
  DB.db.prepare('INSERT INTO player_skills (player_id, skill_id, level) VALUES (?,?,1) ON CONFLICT(player_id, skill_id) DO UPDATE SET level=level+1')
    .run(playerId, skillId);
  DB.updatePlayer(playerId, { skill_points: player.skill_points - skill.cost });
  
  // Apply stat bonuses immediately
  applySkillBonuses(playerId);
  
  await E.msg(sock, jid, `✅ **${skill.emoji} ${skill.name}** upgraded to level **${currentLevel + 1}**!`);
}

// ── Reset skills ─────────────────────────────────────────────────
async function resetSkills(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  if (player.gems < 100) return E.msg(sock, jid, '❌ Skill reset costs 100 💎. /gemstore to buy gems.');
  
  const skills = DB.db.prepare('SELECT * FROM player_skills WHERE player_id=?').all(playerId);
  const totalPoints = skills.reduce((sum, s) => sum + (s.level * SKILLS[s.skill_id]?.cost || 1), 0);
  
  if (totalPoints === 0) return E.msg(sock, jid, '❌ No skills to reset.');
  
  E.takeGems(playerId, 100);
  DB.db.prepare('DELETE FROM player_skills WHERE player_id=?').run(playerId);
  DB.updatePlayer(playerId, { skill_points: player.skill_points + totalPoints });
  
  // Reset stats to base
  const cls = R.class(player.class);
  const baseHp = 100 + (player.level - 1) * 10;
  const baseAtk = 15 + (player.level - 1) * 3;
  const baseDef = 10 + (player.level - 1) * 2;
  
  DB.updatePlayer(playerId, {
    max_hp: Math.floor(baseHp * (cls?.hp_mult || 1)),
    hp: Math.floor(baseHp * (cls?.hp_mult || 1)),
    attack: Math.floor(baseAtk * (cls?.atk_mult || 1)),
    defense: Math.floor(baseDef * (cls?.def_mult || 1))
  });
  
  await E.msg(sock, jid, `🔄 Skills reset! Refunded **${totalPoints}** points. Spend them wisely with /skills`);
}

// ── Apply all skill bonuses (called on level up/load) ───────────
function applySkillBonuses(playerId) {
  const player = DB.getPlayer(playerId);
  const skills = DB.db.prepare('SELECT * FROM player_skills WHERE player_id=?').all(playerId);
  const skillMap = {};
  skills.forEach(s => skillMap[s.skill_id] = s.level);
  
  const cls = R.class(player.class);
  const baseHp = 100 + (player.level - 1) * 10;
  const baseAtk = 15 + (player.level - 1) * 3;
  const baseDef = 10 + (player.level - 1) * 2;
  
  let hpMult = (cls?.hp_mult || 1) * (1 + (skillMap.hp_boost || 0) * 0.05);
  let atkMult = (cls?.atk_mult || 1) * (1 + (skillMap.atk_boost || 0) * 0.03);
  let defMult = (cls?.def_mult || 1) * (1 + (skillMap.def_boost || 0) * 0.03);
  
  DB.updatePlayer(playerId, {
    max_hp: Math.floor(baseHp * hpMult),
    attack: Math.floor(baseAtk * atkMult),
    defense: Math.floor(baseDef * defMult)
  });
}

module.exports = { showSkills, levelUp, resetSkills, applySkillBonuses };
