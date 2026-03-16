// ════════════════════════════════════════════════════════════
//  gameEngine.js  —  Core math: XP, ELO, damage, cooldowns
// ════════════════════════════════════════════════════════════
'use strict';

const { getPlayer, updatePlayer, addOdds, addGems } = require('./database');
const R = require('../registry');

// ── XP & Leveling ────────────────────────────────────────────
function xpNeeded(level) {
  const base = R().game.leveling.xp_base;
  const mult = R().game.leveling.xp_multiplier;
  return Math.floor(base * Math.pow(mult, level - 1));
}

function giveXP(playerId, rawXp) {
  const player = getPlayer(playerId);
  if (!player) return { leveled: false };

  const mults = prestigeMults(player);
  const xp    = Math.floor(rawXp * mults.xp);
  let   total = player.xp + xp;
  let   level = player.level;
  let   sp    = 0;

  while (total >= xpNeeded(level)) {
    total -= xpNeeded(level);
    level++;
    sp++;
  }

  const leveled = level > player.level;
  const updates = { xp: total, level, skill_points: player.skill_points + sp };
  if (leveled) {
    updates.max_hp  = 100 + (level - 1) * 10;
    updates.hp      = updates.max_hp;
    updates.attack  = 15  + (level - 1) * 3;
    updates.defense = 10  + (level - 1) * 2;
  }
  updatePlayer(playerId, updates);
  return { leveled, old: player.level, new: level, sp_gained: sp, xp_given: xp };
}

// ── Currency (wraps database, applies prestige multiplier) ───
function giveOdds(playerId, raw) {
  const p = getPlayer(playerId);
  if (!p) return 0;
  const final = Math.floor(raw * prestigeMults(p).odds);
  return addOdds(playerId, final);
}

function takeOdds(playerId, amt) { return addOdds(playerId, -amt); }
function giveGems(playerId, amt) { return addGems(playerId, amt);  }
function takeGems(playerId, amt) { return addGems(playerId, -amt); }

// ── Prestige multipliers ─────────────────────────────────────
function prestigeMults(playerOrId) {
  const p     = typeof playerOrId === 'string' ? getPlayer(playerOrId) : playerOrId;
  const tiers = R().game.prestige.tiers;
  const t     = tiers[Math.min((p?.prestige || 0) - 1, tiers.length - 1)];
  return { odds: t?.odds_x || 1.0, xp: t?.xp_x || 1.0 };
}

// ── ELO ──────────────────────────────────────────────────────
function getEloRank(elo) {
  const ranks = [...R().game.pvp.ranks].sort((a, b) => b.min_elo - a.min_elo);
  return ranks.find(r => elo >= r.min_elo) || R().game.pvp.ranks[0];
}

function calcEloChange(winnerElo, loserElo) {
  const E    = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const gain = Math.max(1, Math.round(32 * (1 - E)));
  const loss = Math.max(1, Math.round(32 * E));
  return { gain, loss };
}

// ── Damage calculation ───────────────────────────────────────
function calcDamage(atkStat, action = 'attack', extraCritChance = 0) {
  const acts = R().game.combat.actions;
  const cfg  = acts[action] || acts.attack;

  if (cfg.miss_chance && rand() * 100 < cfg.miss_chance) {
    return { dmg: 0, crit: false, missed: true };
  }

  const pct = (cfg.dmg_min || 90) + rand() * ((cfg.dmg_max || 110) - (cfg.dmg_min || 90));
  let   dmg = Math.max(1, Math.floor(atkStat * pct / 100));

  const critRoll = rand() * 100 < R().game.combat.crit_chance + extraCritChance;
  if (critRoll) dmg = Math.floor(dmg * R().game.combat.crit_multiplier);

  return { dmg: Math.max(1, dmg), crit: critRoll, missed: false };
}

function reduceDamage(dmg, def, defending = false) {
  let d = dmg - Math.floor(def * 0.4);
  if (defending) d = Math.floor(d * (1 - (R().game.combat.actions.defend?.reduction_pct || 65) / 100));
  return Math.max(1, d);
}

// ── Cooldowns ────────────────────────────────────────────────
function cdLeft(lastTime, mins) {
  if (!lastTime) return 0;
  const elapsed = (Date.now() - new Date(lastTime).getTime()) / 60000;
  return Math.max(0, Math.ceil(mins - elapsed));
}
function cdOver(lastTime, mins) { return cdLeft(lastTime, mins) === 0; }

// ── Display helpers ──────────────────────────────────────────
function hpBar(cur, max, len = 10) {
  const fill = Math.max(0, Math.round((cur / max) * len));
  return `${'█'.repeat(fill)}${'░'.repeat(len - fill)} ${cur}/${max}`;
}

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

// ── Random helpers ───────────────────────────────────────────
function rand()          { return Math.random(); }
function rng(min, max)   { return Math.floor(rand() * (max - min + 1)) + min; }
function roll(pct)       { return rand() * 100 < pct; }

// ── Message send helper ──────────────────────────────────────
async function msg(sock, jid, text) {
  try { return await sock.sendMessage(jid, { text }); }
  catch (e) { console.error('[msg]', e.message); return null; }
}

async function msgPlayer(sock, playerId, text) {
  return msg(sock, `${playerId}@s.whatsapp.net`, text);
}

module.exports = {
  xpNeeded, giveXP, giveOdds, takeOdds, giveGems, takeGems,
  prestigeMults, getEloRank, calcEloChange,
  calcDamage, reduceDamage,
  cdLeft, cdOver, hpBar, fmt, rand, rng, roll,
  msg, msgPlayer,
};
