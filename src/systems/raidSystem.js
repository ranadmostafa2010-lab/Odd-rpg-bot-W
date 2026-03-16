'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const RAID_BOSSES = [
  {
    id: 'ancient_titan', name: 'Ancient Titan', emoji: '🗿',
    total_hp: 50000, attack: 80, defense: 40,
    desc: 'A colossal stone titan woken from its slumber.',
    phase2_threshold: 0.5, phase2_atk_mult: 1.5,
    phase2_msg: '💥 The Titan ENRAGES!',
    rewards: { odds_per_dmg: 2, completion_odds: 5000, completion_gems: 10, top3_bonus_gems: 20 },
    pet_drop: { pet_id: 'celestial_dragon', chance_pct: 5 },
  },
  {
    id: 'chaos_hydra', name: 'Chaos Hydra', emoji: '🐍🔥',
    total_hp: 75000, attack: 120, defense: 60,
    desc: 'A 5-headed hydra that grows stronger as you hurt it.',
    phase2_threshold: 0.3, phase2_atk_mult: 2.0,
    phase2_msg: '💥 Chaos Hydra regrows a head — Phase 2!',
    rewards: { odds_per_dmg: 3, completion_odds: 10000, completion_gems: 20, top3_bonus_gems: 50 },
    pet_drop: { pet_id: 'void_wolf', chance_pct: 10 },
  },
];

async function spawnRaid(sock, bossId) {
  const active = DB.db.prepare("SELECT 1 FROM active_raids WHERE status='active'").get();
  if (active) { console.log('[raid] Raid already active'); return; }

  const boss = RAID_BOSSES.find(b => b.id === bossId) || RAID_BOSSES[0];

  DB.db.prepare('INSERT INTO active_raids (boss_id,current_hp,max_hp) VALUES(?,?,?)').run(boss.id, boss.total_hp, boss.total_hp);

  const players = DB.db.prepare("SELECT id FROM players WHERE is_banned=0 AND last_login > datetime('now','-24 hours')").all();
  const msg =
    `⚠️ *RAID BOSS SPAWNED!*\n\n` +
    `${boss.emoji} **${boss.name}**\n_${boss.desc}_\n\n` +
    `❤️ HP: ${E.fmt(boss.total_hp)}\n` +
    `💰 ${boss.rewards.odds_per_dmg} 🪙 per damage dealt!\n\n` +
    `/raid — Join the fight!\n/raidattack — Attack`;

  for (const p of players) await E.msgPlayer(sock, p.id, msg).catch(() => {});
}

async function showRaid(sock, jid, playerId) {
  const raid = DB.db.prepare("SELECT * FROM active_raids WHERE status='active'").get();
  if (!raid) return E.msg(sock, jid, '❌ No active raid right now. Check back later!');

  const boss     = RAID_BOSSES.find(b => b.id === raid.boss_id);
  const parts    = JSON.parse(raid.participants || '{}');
  const myDamage = parts[playerId] || 0;
  const total    = Object.keys(parts).length;
  const sorted   = Object.entries(parts).sort(([,a],[,b]) => b-a).slice(0,3);

  let msg =
    `${boss.emoji} **${boss.name}** — Phase ${raid.phase}\n\n` +
    `❤️ ${E.hpBar(raid.current_hp, raid.max_hp, 12)} ${E.fmt(raid.current_hp)}\n` +
    `👥 ${total} fighters | Your damage: **${E.fmt(myDamage)}**\n\n` +
    `🏆 *Top Damage:*\n`;

  const medals = ['🥇','🥈','🥉'];
  for (let i = 0; i < sorted.length; i++) {
    const [pid, dmg] = sorted[i];
    msg += `${medals[i]} ${DB.getPlayer(pid)?.name || pid}: ${E.fmt(dmg)}\n`;
  }

  msg += `\n/raidattack — Attack!\n/raidheavy — Heavy attack`;
  await E.msg(sock, jid, msg);
}

async function raidAttack(sock, jid, playerId, type = 'attack') {
  const raid = DB.db.prepare("SELECT * FROM active_raids WHERE status='active'").get();
  if (!raid) return E.msg(sock, jid, '❌ No active raid.');

  // 30-second raid cooldown per player (in-memory)
  const key = `raid_cd_${playerId}`;
  if (global[key] && Date.now() - global[key] < 30000) {
    return E.msg(sock, jid, `⏳ Raid cooldown: **${Math.ceil((30000-(Date.now()-global[key]))/1000)}s**`);
  }
  global[key] = Date.now();

  const player = DB.getPlayer(playerId);
  const boss   = RAID_BOSSES.find(b => b.id === raid.boss_id);
  const res    = E.calcDamage(player.attack, type === 'raidheavy' ? 'heavy_attack' : 'attack');
  const dmg    = res.missed ? 0 : res.dmg;
  const parts  = JSON.parse(raid.participants || '{}');

  parts[playerId] = (parts[playerId] || 0) + dmg;
  const newHp = Math.max(0, raid.current_hp - dmg);

  // Phase 2
  let phaseMsg = '';
  let newPhase = raid.phase;
  if (newPhase === 1 && newHp / raid.max_hp <= boss.phase2_threshold) {
    newPhase = 2;
    phaseMsg = `\n\n${boss.phase2_msg}`;
    const activePlayers = DB.db.prepare("SELECT id FROM players WHERE is_banned=0 AND last_login > datetime('now','-1 hours')").all();
    for (const p of activePlayers) E.msgPlayer(sock, p.id, `⚠️ *RAID UPDATE!* ${boss.phase2_msg}`).catch(() => {});
  }

  DB.db.prepare('UPDATE active_raids SET current_hp=?,phase=?,participants=? WHERE id=?').run(newHp, newPhase, JSON.stringify(parts), raid.id);

  // Instant Odds reward
  const oddsEarned = dmg * boss.rewards.odds_per_dmg;
  if (oddsEarned > 0) E.giveOdds(playerId, oddsEarned);

  // Counter-attack chance
  let counterMsg = '';
  if (!res.missed && E.roll(30)) {
    const atkMult  = newPhase === 2 ? boss.phase2_atk_mult : 1;
    const counterDmg = Math.max(1, Math.floor(boss.attack * atkMult) - Math.floor(player.defense * 0.5));
    DB.updatePlayer(playerId, { hp: Math.max(1, player.hp - counterDmg) });
    counterMsg = `\n${boss.emoji} Counter-attacks you for **${counterDmg}**!`;
  }

  let replyMsg = res.missed
    ? `🎯 Your attack *missed* the raid boss!`
    : `⚔️ You deal **${E.fmt(dmg)}** damage!\n🪙 +${E.fmt(oddsEarned)} Odds`;

  replyMsg += `\n${boss.emoji} HP: ${E.hpBar(newHp, raid.max_hp)} ${E.fmt(newHp)}`;
  replyMsg += counterMsg;
  replyMsg += phaseMsg;

  await E.msg(sock, jid, replyMsg);

  if (newHp === 0) await endRaid(sock, raid, boss, parts);
}

async function endRaid(sock, raid, boss, participants) {
  DB.db.prepare("UPDATE active_raids SET status='complete' WHERE id=?").run(raid.id);
  const sorted = Object.entries(participants).sort(([,a],[,b]) => b-a);

  for (let i = 0; i < sorted.length; i++) {
    const [pid, dmg] = sorted[i];
    const isTop3 = i < 3;
    E.giveOdds(pid, boss.rewards.completion_odds);
    E.giveGems(pid, boss.rewards.completion_gems + (isTop3 ? boss.rewards.top3_bonus_gems : 0));
    E.giveXP(pid, 5000);
    DB.updatePlayer(pid, { bosses_killed: (DB.getPlayer(pid)?.bosses_killed || 0) + 1 });

    let petMsg = '';
    if (boss.pet_drop && E.roll(boss.pet_drop.chance_pct)) {
      DB.addPet(pid, boss.pet_drop.pet_id);
      const p = R.pet(boss.pet_drop.pet_id);
      petMsg = `\n🐾 **RARE PET DROP!** ${p?.emoji} ${p?.name}!`;
    }

    const medals = ['🥇','🥈','🥉'];
    await E.msgPlayer(sock, pid,
      `🏆 *RAID DEFEATED!*\n\n${boss.emoji} **${boss.name}**\n\n` +
      `Your damage: **${E.fmt(dmg)}**\n` +
      (isTop3 ? `${medals[i]} TOP 3 BONUS!\n` : '') +
      `🪙 +${E.fmt(boss.rewards.completion_odds)} Odds\n` +
      `💎 +${boss.rewards.completion_gems + (isTop3 ? boss.rewards.top3_bonus_gems : 0)} Gems` +
      petMsg
    ).catch(() => {});
  }
}

module.exports = { spawnRaid, showRaid, raidAttack, RAID_BOSSES };
