'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const BM  = require('../core/battleManager');

// ── Start PvE battle ──────────────────────────────────────────
async function startBattle(sock, jid, playerId, difficulty = 'normal') {
  const cfg = R().game.pve;
  if (!cfg.difficulties[difficulty]) difficulty = 'normal';

  const player = DB.getPlayer(playerId);
  const diff   = cfg.difficulties[difficulty];

  if (diff.min_level && player.level < diff.min_level) {
    return E.msg(sock, jid, `❌ ${difficulty.toUpperCase()} requires Level **${diff.min_level}**!`);
  }

  const cd = E.cdLeft(player.last_battle, cfg.cooldown_minutes);
  if (cd > 0) return E.msg(sock, jid, `⏳ Battle cooldown: **${cd}m** remaining.`);

  // Check for existing battle
  const existing = DB.getBattle(playerId);
  if (existing) return E.msg(sock, jid, '❌ Finish your current battle first! /attack /flee');

  // Pick enemy based on world/story progress
  let enemyPool = R.enemyPool(player.story_world, player.level);
  if (!enemyPool.length) enemyPool = R().enemies.filter(e => e.min_level <= player.level);
  
  const baseEnemy = enemyPool[Math.floor(Math.random() * enemyPool.length)];
  const isBoss = Math.random() * 100 < cfg.random_boss_chance_pct;
  
  let enemy, meta;
  
  if (isBoss) {
    const bossTemplate = R().bosses[Math.floor(Math.random() * R().bosses.length)];
    enemy = {
      id: bossTemplate.id,
      name: bossTemplate.name,
      emoji: bossTemplate.emoji,
      hp: Math.floor(bossTemplate.hp * diff.hp_mult),
      attack: Math.floor(bossTemplate.attack * diff.atk_mult),
      defense: bossTemplate.defense
    };
    meta = {
      battle_type: 'boss',
      odds: Math.floor(bossTemplate.hp * diff.odds_mult / 10),
      xp: Math.floor(bossTemplate.hp * diff.xp_mult / 5),
      gems: 2,
      is_boss: true,
      pet_drops: bossTemplate.pet_drop ? [bossTemplate.pet_drop] : [],
      mat_drops: bossTemplate.mat_drops || []
    };
  } else {
    const levelScale = 1 + (player.level - 1) * 0.05;
    enemy = {
      id: baseEnemy.id,
      name: baseEnemy.name,
      emoji: baseEnemy.emoji,
      hp: Math.floor(baseEnemy.base_hp * diff.hp_mult * levelScale),
      attack: Math.floor(baseEnemy.base_attack * diff.atk_mult * levelScale),
      defense: Math.floor(baseEnemy.base_defense * diff.atk_mult)
    };
    meta = {
      battle_type: 'pve',
      odds: Math.floor(enemy.hp * diff.odds_mult / 5),
      xp: Math.floor(enemy.hp * diff.xp_mult / 3),
      gems: Math.random() < 0.1 ? 1 : 0,
      is_boss: false,
      pet_drops: [],
      mat_drops: [{ mat_id: 'monster_core', chance_pct: 15 * diff.mat_mult, min_qty: 1, max_qty: 3 }]
    };
  }

  const state = BM.buildState(player, enemy, meta);
  DB.saveBattle(playerId, meta.battle_type, state);

  await E.msg(sock, jid,
    `⚔️ *BATTLE START!*\n\n` +
    `${isBoss ? '👑 **RANDOM BOSS!** ' : ''}${enemy.emoji} **${enemy.name}** ` +
    `(Lv.${Math.floor(enemy.attack/3)} ${difficulty.toUpperCase()})\n\n` +
    `❤️ ${E.hpBar(enemy.hp, enemy.hp)}\n` +
    `⚔️ ATK: ${enemy.attack}  🛡️ DEF: ${enemy.defense}\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `🧍 **You**  ${E.hpBar(player.hp, player.max_hp)}\n` +
    `⚔️ ATK: ${state.p_atk}  🛡️ DEF: ${state.p_def}\n` +
    `━━━━━━━━━━━━━━\n\n` +
    `Turn 1 — Choose:\n` +
    `/attack  /heavy  /defend\n` +
    `/heal  /special .hp * diff.hp_mult),
      attack: Math.floor(bossTemplate.attack * diff.atk_mult),
      defense: bossTemplate.defense
    };
    meta = {
      battle_type: 'boss',
      odds: Math.floor(bossTemplate.hp * diff.odds_mult / 10),
      xp: Math.floor(bossTemplate.hp * diff.xp_mult / 5),
      gems: 2,
      is_boss: true,
      pet_drops: bossTemplate.pet_drop ? [bossTemplate.pet_drop] : [],
      mat_drops: bossTemplate.mat_drops || []
    };
  } else {
    const levelScale = 1 + (player.level - 1) * 0.05;
    enemy = {
      id: baseEnemy.id,
      name: baseEnemy.name,
      emoji: baseEnemy.emoji,
      hp: Math.floor(baseEnemy.base_hp * diff.hp_mult * levelScale),
      attack: Math.floor(baseEnemy.base_attack * diff.atk_mult * levelScale),
      defense: Math.floor(baseEnemy.base_defense * diff.atk_mult)
    };
    meta = {
      battle_type: 'pve',
      odds: Math.floor(enemy.hp * diff.odds_mult / 5),
      xp: Math.floor(enemy.hp * diff.xp_mult / 3),
      gems: Math.random() < 0.1 ? 1 : 0,
      is_boss: false,
      pet_drops: [],
      mat_drops: [{ mat_id: 'monster_core', chance_pct: 15 * diff.mat_mult, min_qty: 1, max_qty: 3 }]
    };
  }

  const state = BM.buildState(player, enemy, meta);
  DB.saveBattle(playerId, meta.battle_type, state);

  await E.msg(sock, jid,
    `⚔️ *BATTLE START!*\n\n` +
    `${isBoss ? '👑 **RANDOM BOSS!** ' : ''}${enemy.emoji} **${enemy.name}** ` +
    `(Lv.${Math.floor(enemy.attack/3)} ${difficulty.toUpperCase()})\n\n` +
    `❤️ ${E.hpBar(enemy.hp, enemy.hp)}\n` +
    `⚔️ ATK: ${enemy.attack}  🛡️ DEF: ${enemy.defense}\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `🧍 **You**  ${E.hpBar(player.hp, player.max_hp)}\n` +
    `⚔️ ATK: ${state.p_atk}  🛡️ DEF: ${state.p_def}\n` +
    `━━━━━━━━━━━━━━\n\n` +
    `Turn 1 — Choose:\n` +
    `/attack  /heavy  /defend\n` +
    `/heal  /special  /flee`
  );
}

// ── Story system ─────────────────────────────────────────────
async function showStory(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const world  = R.world(player.story_world);
  
  let msg = `📖 *Story Progress*\n\n`;
  msg += `🌍 **${world.name}** ${world.emoji}\n`;
  msg += `Chapter **${player.story_chapter}** / ${world.chapters}\n`;
  msg += `_${world.desc}_\n\n`;
  
  if (player.story_chapter > world.chapters) {
    msg += `✅ **World Complete!**\n`;
    msg += `Boss: ${world.boss.emoji} **${world.boss.name}**\n`;
    msg += `/story next — Travel to next world`;
  } else {
    msg += `Current chapter: **${player.story_chapter}**\n`;
    msg += `Enemies: ${world.enemy_pool.slice(0,3).map(id => R.enemy(id)?.emoji).join(' ')}\n\n`;
    msg += `/battle to fight story enemies\n`;
    msg += `Clear ${world.chapters - player.story_chapter + 1} more chapters to face the boss!`;
  }
  
  await E.msg(sock, jid, msg);
}

async function advanceStory(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const world  = R.world(player.story_world);
  
  if (player.story_chapter <= world.chapters) {
    return E.msg(sock, jid, `❌ Complete all ${world.chapters} chapters first! (${world.chapters - player.story_chapter + 1} remaining)`);
  }
  
  // Boss fight
  const boss = world.boss;
  const existing = DB.getBattle(playerId);
  if (existing) return E.msg(sock, jid, '❌ Finish your current battle first!');
  
  const meta = {
    battle_type: 'story_boss',
    odds: world.rewards.odds,
    xp: world.rewards.xp,
    gems: world.rewards.gems,
    is_boss: true,
    pet_drops: world.rewards.pet_drop ? [world.rewards.pet_drop] : [],
    mat_drops: []
  };
  
  const enemy = {
    id: boss.id,
    name: boss.name,
    emoji: boss.emoji,
    hp: boss.hp,
    attack: boss.attack,
    defense: boss.defense
  };
  
  const state = BM.buildState(player, enemy, meta);
  DB.saveBattle(playerId, 'story_boss', state);
  
  await E.msg(sock, jid,
    `👑 **WORLD BOSS BATTLE!**\n\n` +
    `${boss.emoji} **${boss.name}**\n` +
    `_${boss.desc}_\n\n` +
    `❤️ ${E.hpBar(boss.hp, boss.hp)}\n` +
    `⚔️ ATK: ${boss.attack}  🛡️ DEF: ${boss.defense}\n\n` +
    `🎁 Victory rewards:\n` +
    `🪙 ${E.fmt(world.rewards.odds)}  ⭐ ${E.fmt(world.rewards.xp)}  💎 ${world.rewards.gems}\n\n` +
    `/attack  /heavy  /defend  /heal  /special  /flee`
  );
}

// ── Offline grind (called on /start login) ────────────────────
async function collectOfflineGrind(sock, jid, playerId) {
  const cfg = R().game.offline_grind;
  if (!cfg.enabled) return;
  
  const player = DB.getPlayer(playerId);
  if (!player.offline_since) return;
  
  const offlineMs = Date.now() - new Date(player.offline_since).getTime();
  const hours = Math.min(Math.floor(offlineMs / 3600000), cfg.max_hours);
  
  if (hours < 1) return;
  
  const odds = hours * cfg.odds_per_hour;
  const xp = hours * cfg.xp_per_hour;
  
  E.giveOdds(playerId, odds);
  E.giveXP(playerId, xp);
  
  let matsMsg = '';
  if (E.roll(cfg.material_chance_pct)) {
    DB.addMat(playerId, 'monster_core', 1);
    matsMsg = `\n🧪 Found 1 monster_core while away!`;
  }
  
  await E.msg(sock, jid,
    `💤 *Offline Grind Results*\n\n` +
    `Away for **${hours}h** (max ${cfg.max_hours}h)\n` +
    `🪙 +${E.fmt(odds)} Odds\n` +
    `⭐ +${E.fmt(xp)} XP` + matsMsg
  );
}

module.exports = { startBattle, showStory, advanceStory, collectOfflineGrind };
