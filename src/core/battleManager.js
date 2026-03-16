// ════════════════════════════════════════════════════════════
//  battleManager.js  —  Turn-based combat engine
//  Used by PvE, story, and dungeon systems
// ════════════════════════════════════════════════════════════
'use strict';

const DB  = require('./database');
const E   = require('./gameEngine');
const R   = require('../registry');

// ── Build initial battle state ────────────────────────────────
function buildState(player, enemy, meta = {}) {
  const pet = player.equipped_pet ? R.pet(player.equipped_pet) : null;
  return {
    // Enemy
    e_id: enemy.id, e_name: enemy.name, e_emoji: enemy.emoji,
    e_hp: enemy.hp, e_max_hp: enemy.hp,
    e_atk: enemy.attack, e_def: enemy.defense || 0,
    e_stunned: false, e_poisoned: false, e_poison_pct: 0,
    // Player
    p_hp: player.hp, p_max_hp: player.max_hp,
    p_atk: player.attack + (pet?.bonus_attack || 0),
    p_def: player.defense + (pet?.bonus_defense || 0),
    is_defending: false, arcane_surge: false, force_crit: false,
    // Cooldowns
    heal_cd: 0, special_cd: 0, class_cd: 0,
    // Meta
    turn: 1, first_turn: true,
    battle_type: meta.battle_type || 'pve',
    odds_reward: meta.odds || 0,
    xp_reward:   meta.xp   || 0,
    gems_reward: meta.gems || 0,
    pet_drops:   meta.pet_drops || [],
    mat_drops:   meta.mat_drops || [],
    is_boss:     meta.is_boss   || false,
  };
}

// ── Main action processor ─────────────────────────────────────
async function doAction(sock, jid, playerId, action) {
  const battle = DB.getBattle(playerId);
  if (!battle) return E.msg(sock, jid, '❌ You are not in a battle!\nStart one with /battle');

  const state  = battle.data;
  const player = DB.getPlayer(playerId);

  // ── Class skills route ─────────────────────────────────────
  const classSkills = { bash:1, meteor:1, backstab:1, nova:1, rampage:1 };
  if (classSkills[action]) return doClassSkill(sock, jid, playerId, action, state, player);

  // ── Passive effects ────────────────────────────────────────
  state.passive_msg = '';
  applyPassives(player.class, state, true);

  let pMsg = '';
  state.is_defending = false;

  switch (action) {
    case 'attack':
    case 'heavy_attack': {
      const forceCrit = state.force_crit; state.force_crit = false;
      const res = E.calcDamage(state.p_atk, action);
      if (state.arcane_surge) { res.dmg *= 2; state.arcane_surge = false; }
      if (forceCrit)          { res.crit = true; res.dmg = Math.floor(state.p_atk * R().game.combat.crit_multiplier); }

      if (res.missed) { pMsg = `⚔️ Your attack *missed*!`; break; }
      state.e_hp -= res.dmg;
      pMsg = res.crit ? `💥 *CRITICAL HIT!* **${res.dmg}** damage!` : `⚔️ You deal **${res.dmg}** damage!`;
      break;
    }
    case 'defend': {
      state.is_defending = true;
      const heal = Math.floor(state.p_max_hp * 0.05);
      state.p_hp = Math.min(state.p_max_hp, state.p_hp + heal);
      pMsg = `🛡️ Defensive stance! (+${heal} HP, reduced damage)`;
      break;
    }
    case 'heal': {
      if (state.heal_cd > 0) return E.msg(sock, jid, `❌ Heal on cooldown: **${state.heal_cd}** turn(s).`);
      const heal = Math.floor(state.p_max_hp * R().game.combat.actions.heal.heal_pct / 100);
      state.p_hp = Math.min(state.p_max_hp, state.p_hp + heal);
      state.heal_cd = R().game.combat.actions.heal.cooldown_turns;
      pMsg = `💚 You heal for **${heal}** HP!`;
      break;
    }
    case 'special': {
      if (!player.equipped_pet) return E.msg(sock, jid, '❌ Equip a pet first! (/equip)');
      if (state.special_cd > 0) return E.msg(sock, jid, `❌ Special on cooldown: **${state.special_cd}** turn(s).`);
      const pet  = R.pet(player.equipped_pet);
      const res  = E.calcDamage(state.p_atk, 'attack');
      const dmg  = Math.floor(res.dmg * (pet?.special_multiplier || 1.8));
      state.e_hp -= dmg;
      state.special_cd = R().game.combat.actions.special.cooldown_turns;
      pMsg = `✨ **${pet?.name}** uses **${pet?.special_name}** for **${dmg}** damage!`;
      break;
    }
    case 'flee': {
      if (E.roll(R().game.combat.actions.flee.success_chance)) {
        DB.clearBattle(playerId);
        DB.updatePlayer(playerId, { last_battle: now() });
        return E.msg(sock, jid, '🏃 You fled the battle successfully!');
      }
      pMsg = '🏃 You tried to flee but *failed*!';
      break;
    }
  }

  state.first_turn = false;
  if (state.heal_cd    > 0) state.heal_cd--;
  if (state.special_cd > 0) state.special_cd--;
  if (state.class_cd   > 0) state.class_cd--;
  if (state.passive_msg) pMsg += `\n${state.passive_msg}`;

  // ── Enemy dead? ────────────────────────────────────────────
  if (state.e_hp <= 0) {
    state.e_hp = 0;
    DB.clearBattle(playerId);
    DB.updatePlayer(playerId, { hp: state.p_hp, last_battle: now() });
    return victory(sock, jid, playerId, player, state, pMsg);
  }

  // ── Enemy turn ─────────────────────────────────────────────
  let eMsg = '';

  if (state.e_poisoned) {
    const pd = Math.floor(state.e_max_hp * state.e_poison_pct / 100);
    state.e_hp -= pd;
    eMsg += `☠️ Poison: **${pd}** damage to ${state.e_name}!\n`;
    if (state.e_hp <= 0) {
      DB.clearBattle(playerId);
      DB.updatePlayer(playerId, { hp: state.p_hp, last_battle: now() });
      return victory(sock, jid, playerId, player, state, pMsg);
    }
  }

  if (state.e_stunned) {
    state.e_stunned = false;
    eMsg += `💫 ${state.e_name} is stunned — skips attack!`;
  } else {
    const r = E.rand();
    if (r < 0.6) {
      const res = E.calcDamage(state.e_atk, 'attack');
      const dmg = E.reduceDamage(res.dmg, state.p_def, state.is_defending);
      state.p_hp -= dmg;
      eMsg = res.crit ? `💥 *CRIT!* ${state.e_name} hits you for **${dmg}**!` : `👊 ${state.e_name} hits you for **${dmg}**!`;
    } else if (r < 0.8) {
      const res = E.calcDamage(state.e_atk, 'heavy_attack');
      if (res.missed) { eMsg = `🎯 ${state.e_name}'s heavy attack *missed*!`; }
      else { const dmg = E.reduceDamage(res.dmg, state.p_def, state.is_defending); state.p_hp -= dmg; eMsg = `🪓 ${state.e_name} heavy attacks for **${dmg}**!`; }
    } else {
      const heal = Math.floor(state.e_max_hp * 0.08);
      state.e_hp = Math.min(state.e_max_hp, state.e_hp + heal);
      eMsg = `💚 ${state.e_name} regenerates **${heal}** HP!`;
    }
  }

  state.turn++;

  if (state.p_hp <= 0) {
    state.p_hp = 0;
    DB.clearBattle(playerId);
    DB.updatePlayer(playerId, { hp: 1, last_battle: now() });
    return E.msg(sock, jid,
      `${pMsg}\n${eMsg}\n\n` +
      `💀 *You were defeated by ${state.e_name}!*\n` +
      `You wake up with 1 HP. Use potions or rest.`
    );
  }

  // Healer regen passive
  if (player.class === 'healer') {
    const regen = Math.floor(state.p_max_hp * 0.05);
    state.p_hp  = Math.min(state.p_max_hp, state.p_hp + regen);
  }

  DB.saveBattle(playerId, battle.battle_type, state);

  const hCD = state.heal_cd    > 0 ? `(${state.heal_cd}🔄)` : '';
  const sCD = state.special_cd > 0 ? `(${state.special_cd}🔄)` : '';
  const cCD = state.class_cd   > 0 ? `(${state.class_cd}🔄)` : '';
  const clsCmd = player.class ? `/${R.class(player.class)?.cmd}${cCD}` : '';

  await E.msg(sock, jid,
    `${pMsg}\n${eMsg}\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `🧍 **You**  ${E.hpBar(state.p_hp, state.p_max_hp)}\n` +
    `${state.e_emoji} **${state.e_name}**  ${E.hpBar(state.e_hp, state.e_max_hp)}\n` +
    `━━━━━━━━━━━━━━\n` +
    `Turn ${state.turn} — Choose:\n` +
    `/attack  /heavy  /defend\n` +
    `/heal${hCD}  /special${sCD}  /flee\n` +
    (clsCmd ? clsCmd : '')
  );
}

// ── Class skills ──────────────────────────────────────────────
async function doClassSkill(sock, jid, playerId, skill, state, player) {
  if (!player.class) return E.msg(sock, jid, '❌ Choose a class with /class first!');
  const cls = R.class(player.class);
  if (!cls)           return E.msg(sock, jid, '❌ Class data not found.');
  if (cls.cmd !== skill) return E.msg(sock, jid, `❌ Your class skill is **/${cls.cmd}**, not /${skill}`);
  if (state.class_cd > 0) return E.msg(sock, jid, `❌ ${cls.skill_name} on cooldown: **${state.class_cd}** turn(s).`);

  const sk  = cls.skill;
  let   msg = '';
  const base = state.p_atk;

  switch (sk.type) {
    case 'stun': {
      const res = E.calcDamage(base, 'attack');
      state.e_hp -= res.dmg;
      state.e_stunned = true;
      msg = `⚔️ **${cls.skill_name}!** ${res.dmg} damage + enemy STUNNED next turn!`;
      break;
    }
    case 'damage': {
      let dmg = Math.floor(base * sk.dmg_mult);
      if (sk.force_crit) dmg = Math.floor(dmg * R().game.combat.crit_multiplier);
      state.e_hp -= dmg;
      msg = `🔮 **${cls.skill_name}!** ${dmg} damage!${sk.force_crit ? ' (FORCED CRIT)' : ''}`;
      break;
    }
    case 'backstab': {
      const dmg = Math.floor(base * sk.dmg_mult);
      state.e_hp -= dmg;
      if (E.roll(sk.poison_chance)) {
        state.e_poisoned   = true;
        state.e_poison_pct = sk.poison_pct;
        msg = `🗡️ **${cls.skill_name}!** ${dmg} damage + POISON (${sk.poison_pct}%/turn)!`;
      } else {
        msg = `🗡️ **${cls.skill_name}!** ${dmg} damage! (Poison didn't proc)`;
      }
      break;
    }
    case 'nova': {
      const dmg  = Math.floor(base * sk.dmg_mult);
      const heal = Math.floor(state.p_max_hp * sk.heal_pct / 100);
      state.e_hp -= dmg;
      state.p_hp  = Math.min(state.p_max_hp, state.p_hp + heal);
      msg = `💊 **${cls.skill_name}!** ${dmg} damage AND healed ${heal} HP!`;
      break;
    }
    case 'multihit': {
      const missing = 1 - state.p_hp / state.p_max_hp;
      const atkBoost = base * (1 + missing * 2);
      let   total = 0, hits = [];
      for (let i = 0; i < sk.hits; i++) {
        const h = Math.max(1, Math.floor(atkBoost * sk.dmg_per_hit));
        hits.push(h); total += h; state.e_hp -= h;
      }
      msg = `🪓 **${cls.skill_name}!** ${sk.hits} hits: ${hits.join('+')} = **${total}** total!`;
      break;
    }
  }

  state.class_cd = cls.skill_cd;
  state.turn++;

  if (state.e_hp <= 0) {
    state.e_hp = 0;
    DB.clearBattle(playerId);
    DB.updatePlayer(playerId, { hp: state.p_hp, last_battle: now() });
    return victory(sock, jid, playerId, player, state, msg);
  }

  DB.saveBattle(playerId, 'pve', state);
  await E.msg(sock, jid,
    `${msg}\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `🧍 **You**  ${E.hpBar(state.p_hp, state.p_max_hp)}\n` +
    `${state.e_emoji} **${state.e_name}**  ${E.hpBar(state.e_hp, state.e_max_hp)}\n` +
    `━━━━━━━━━━━━━━\n` +
    `/attack  /heavy  /defend  /heal  /flee`
  );
}

// ── Apply class passives ──────────────────────────────────────
function applyPassives(cls, state, isMyTurn) {
  if (!cls) return;
  if (cls === 'warrior' && !isMyTurn && E.roll(15)) {
    state.block_hit  = true;
    state.passive_msg = '🛡️ Battle Hardened: hit BLOCKED!';
  }
  if (cls === 'mage' && isMyTurn && E.roll(20)) {
    state.arcane_surge = true;
    state.passive_msg  = '🔮 Arcane Surge: next hit DOUBLED!';
  }
  if (cls === 'rogue' && state.first_turn && isMyTurn) {
    state.force_crit  = true;
    state.passive_msg = '🗡️ Shadow Step: first hit CRITS!';
  }
}

// ── Victory handler ───────────────────────────────────────────
async function victory(sock, jid, playerId, player, state, lastMsg = '') {
  const mults      = E.prestigeMults(player);
  const finalOdds  = Math.floor(state.odds_reward * mults.odds);
  const finalXp    = Math.floor(state.xp_reward   * mults.xp);

  E.giveOdds(playerId, finalOdds);
  if (state.gems_reward > 0) E.giveGems(playerId, state.gems_reward);
  const xpR = E.giveXP(playerId, finalXp);

  DB.updatePlayer(playerId, {
    pve_wins:     (player.pve_wins || 0) + 1,
    bosses_killed: state.is_boss ? (player.bosses_killed || 0) + 1 : player.bosses_killed,
    last_battle:  now(),
    hp:           state.p_hp,
  });

  let txt = `🎉 *Victory!*${state.is_boss ? ' ⚠️ **BOSS SLAIN!**' : ''}\n\n`;
  if (lastMsg) txt += `${lastMsg}\n\n`;
  txt += `Defeated: **${state.e_name}**\n`;
  txt += `🪙 +${E.fmt(finalOdds)} Odds\n`;
  txt += `⭐ +${E.fmt(finalXp)} XP\n`;
  if (state.gems_reward > 0) txt += `💎 +${state.gems_reward} Gems\n`;

  // Pet drops
  for (const drop of state.pet_drops) {
    if (E.roll(drop.chance_pct)) {
      DB.addPet(playerId, drop.pet_id);
      const p = R.pet(drop.pet_id);
      txt += `\n🐾 **PET DROP!** ${p?.emoji} **${p?.name}** [${p?.rarity}]!`;
    }
  }

  // Material drops
  for (const drop of state.mat_drops) {
    if (E.roll(drop.chance_pct)) {
      const qty = E.rng(drop.min_qty || 1, drop.max_qty || 1);
      DB.addMat(playerId, drop.mat_id, qty);
      txt += `\n🧪 Material: **${drop.mat_id}** x${qty}`;
    }
  }

  if (xpR.leveled) txt += `\n\n🆙 *LEVEL UP!* ${xpR.old} → **${xpR.new}**! Stats increased!`;
  if (xpR.sp_gained > 0) txt += `\n✨ +${xpR.sp_gained} Skill Point(s)! (/skills)`;

  await E.msg(sock, jid, txt);

  // Track quest + achievement progress
  const Q = require('../systems/questSystem');
  const A = require('../systems/achievementSystem');
  await Q.track(playerId, 'pve_wins',   1);
  await Q.track(playerId, 'odds_earned', finalOdds);
  if (state.is_boss) await Q.track(playerId, 'boss_kills', 1);
  await A.check(sock, playerId);
}

function now() { return new Date().toISOString(); }

module.exports = { buildState, doAction, victory };
