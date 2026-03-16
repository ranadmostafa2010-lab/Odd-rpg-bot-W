'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const activePvp = new Map(); // playerId -> { opponentId, state }

// ── Join queue ────────────────────────────────────────────────
async function joinQueue(sock, jid, playerId) {
  const cfg = R().game.pvp;
  const player = DB.getPlayer(playerId);
  
  const cd = E.cdLeft(player.last_pvp, cfg.cooldown_minutes);
  if (cd > 0) return E.msg(sock, jid, `⏳ PvP cooldown: **${cd}m** remaining.`);
  
  // Check if already in battle
  if (DB.getBattle(playerId)) return E.msg(sock, jid, '❌ Finish your current battle first!');
  if (activePvp.has(playerId)) return E.msg(sock, jid, '❌ Already in a PvP match!');
  
  // Look for opponent in queue
  const queued = DB.db.prepare('SELECT * FROM pvp_queue WHERE player_id != ? AND elo BETWEEN ? AND ? ORDER BY queued_at ASC LIMIT 1').get(
    playerId, 
    player.elo - cfg.elo_range, 
    player.elo + cfg.elo_range
  );
  
  if (queued) {
    // Match found!
    DB.db.prepare('DELETE FROM pvp_queue WHERE player_id = ?').run(queued.player_id);
    await startMatch(sock, playerId, queued.player_id);
  } else {
    // Add to queue
    DB.db.prepare('INSERT OR REPLACE INTO pvp_queue (player_id, elo) VALUES (?, ?)').run(playerId, player.elo);
    await E.msg(sock, jid,
      `⚔️ *Entering PvP Queue...*\n\n` +
      `ELO: **${player.elo}**\n` +
      `Searching for opponent ±${cfg.elo_range} ELO...\n\n` +
      `/pvpcancel — Leave queue`
    );
    
    // Timeout after 90 seconds
    setTimeout(() => checkQueueTimeout(sock, playerId), cfg.matchmaking_timeout_seconds * 1000);
  }
}

async function checkQueueTimeout(sock, playerId) {
  const stillQueued = DB.db.prepare('SELECT 1 FROM pvp_queue WHERE player_id = ?').get(playerId);
  if (!stillQueued) return;
  
  DB.db.prepare('DELETE FROM pvp_queue WHERE player_id = ?').run(playerId);
  await E.msgPlayer(sock, playerId, '⏳ Matchmaking timed out. No opponents found. Try again later!');
}

async function leaveQueue(sock, jid, playerId) {
  const wasQueued = DB.db.prepare('DELETE FROM pvp_queue WHERE player_id = ?').run(playerId).changes;
  if (wasQueued) {
    await E.msg(sock, jid, '✅ Left PvP queue.');
  } else {
    await E.msg(sock, jid, '❌ Not in queue.');
  }
}

// ── Start match ───────────────────────────────────────────────
async function startMatch(sock, p1Id, p2Id) {
  const p1 = DB.getPlayer(p1Id);
  const p2 = DB.getPlayer(p2Id);
  
  const pet1 = p1.equipped_pet ? R.pet(p1.equipped_pet) : null;
  const pet2 = p2.equipped_pet ? R.pet(p2.equipped_pet) : null;
  
  const state = {
    p1: { id: p1Id, name: p1.name, hp: p1.max_hp, max_hp: p1.max_hp, atk: p1.attack + (pet1?.bonus_attack||0), def: p1.defense + (pet1?.bonus_defense||0), class: p1.class },
    p2: { id: p2Id, name: p2.name, hp: p2.max_hp, max_hp: p2.max_hp, atk: p2.attack + (pet2?.bonus_attack||0), def: p2.defense + (pet2?.bonus_defense||0), class: p2.class },
    turn: 1,
    turnPlayer: Math.random() < 0.5 ? p1Id : p2Id,
    p1_heal_cd: 0, p2_heal_cd: 0,
    p1_special_cd: 0, p2_special_cd: 0,
    p1_class_cd: 0, p2_class_cd: 0,
    p1_defending: false, p2_defending: false
  };
  
  activePvp.set(p1Id, { opponentId: p2Id, state, myTurn: state.turnPlayer === p1Id });
  activePvp.set(p2Id, { opponentId: p1Id, state, myTurn: state.turnPlayer === p2Id });
  
  const msg = (me, them, myTurn) =>
    `⚔️ **PvP MATCH FOUND!**\n\n` +
    `${myTurn ? '🔥 YOUR TURN!' : '⏳ Opponent\'s turn...'}\n\n` +
    `🧍 **You:** ${me.name}\n` +
    `❤️ ${E.hpBar(me.hp, me.max_hp)} | ⚔️ ${me.atk} | 🛡️ ${me.def}\n\n` +
    `🧍 **Opponent:** ${them.name}\n` +
    `❤️ ${E.hpBar(them.hp, them.max_hp)} | ⚔️ ${them.atk} | 🛡️ ${them.def}\n\n` +
    (myTurn ? `Your move: /pvpattack /pvpheavy /pvpdefend /pvpheal /pvpspecial /pvpsurrender` : `Waiting for opponent...`);
  
  await E.msgPlayer(sock, p1Id, msg(state.p1, state.p2, state.turnPlayer === p1Id));
  await E.msgPlayer(sock, p2Id, msg(state.p2, state.p1, state.turnPlayer === p2Id));
}

// ── PvP Actions ───────────────────────────────────────────────
async function doAction(sock, jid, playerId, action) {
  const match = activePvp.get(playerId);
  if (!match) return E.msg(sock, jid, '❌ Not in a PvP match. /ranked to queue!');
  
  const { opponentId, state } = match;
  const isP1 = state.p1.id === playerId;
  const me = isP1 ? state.p1 : state.p2;
  const them = isP1 ? state.p2 : state.p1;
  
  if (state.turnPlayer !== playerId) return E.msg(sock, jid, '⏳ Not your turn!');
  
  let pMsg = '';
  let damage = 0;
  let heal = 0;
  
  // Reset defense
  if (isP1) state.p1_defending = false; else state.p2_defending = false;
  
  switch(action) {
    case 'pvpattack':
      damage = Math.max(1, Math.floor(me.atk * (0.9 + Math.random() * 0.2)) - Math.floor(them.def * 0.3));
      if (them.defending) damage = Math.floor(damage * 0.35);
      them.hp -= damage;
      pMsg = `⚔️ You hit **${them.name}** for **${damage}**!`;
      break;
      
    case 'pvpheavy':
      if (Math.random() < 0.25) {
        pMsg = `🎯 Your heavy attack missed!`;
      } else {
        damage = Math.max(1, Math.floor(me.atk * 1.6) - Math.floor(them.def * 0.3));
        if (them.defending) damage = Math.floor(damage * 0.35);
        them.hp -= damage;
        pMsg = `🪓 Heavy attack! **${damage}** damage!`;
      }
      break;
      
    case 'pvpdefend':
      if (isP1) state.p1_defending = true; else state.p2_defending = true;
      heal = Math.floor(me.max_hp * 0.05);
      me.hp = Math.min(me.max_hp, me.hp + heal);
      pMsg = `🛡️ Defending! +${heal} HP`;
      break;
      
    case 'pvpheal':
      const myHealCd = isP1 ? state.p1_heal_cd : state.p2_heal_cd;
      if (myHealCd > 0) return E.msg(sock, jid, `❌ Heal cooldown: ${myHealCd} turns`);
      heal = Math.floor(me.max_hp * 0.25);
      me.hp = Math.min(me.max_hp, me.hp + heal);
      if (isP1) state.p1_heal_cd = 3; else state.p2_heal_cd = 3;
      pMsg = `💚 Healed for **${heal}** HP!`;
      break;
      
    case 'pvpspecial':
      const mySpecCd = isP1 ? state.p1_special_cd : state.p2_special_cd;
      if (mySpecCd > 0) return E.msg(sock, jid, `❌ Special cooldown: ${mySpecCd} turns`);
      const pet = DB.getPlayer(playerId).equipped_pet;
      if (!pet) return E.msg(sock, jid, '❌ No pet equipped!');
      const petData = R.pet(pet);
      damage = Math.max(1, Math.floor(me.atk * (petData?.special_multiplier || 1.8)) - Math.floor(them.def * 0.3));
      if (them.defending) damage = Math.floor(damage * 0.35);
      them.hp -= damage;
      if (isP1) state.p1_special_cd = 4; else state.p2_special_cd = 4;
      pMsg = `✨ **${petData?.name}** uses ${petData?.special_name} for **${damage}**!`;
      break;
      
    case 'pvpsurrender':
      them.hp = 1; // Force win for opponent
      pMsg = `🏳️ You surrendered!`;
      break;
  }
  
  // Decrement cooldowns
  if (isP1) { if (state.p1_heal_cd > 0) state.p1_heal_cd--; if (state.p1_special_cd > 0) state.p1_special_cd--; }
  else { if (state.p2_heal_cd > 0) state.p2_heal_cd--; if (state.p2_special_cd > 0) state.p2_special_cd--; }
  
  // Check win
  if (them.hp <= 0) {
    them.hp = 0;
    await endMatch(sock, state, isP1 ? 'p1' : 'p2');
    return;
  }
  
  // Switch turn
  state.turnPlayer = opponentId;
  state.turn++;
  
  // Update both players
  activePvp.set(playerId, { opponentId, state, myTurn: false });
  activePvp.set(opponentId, { opponentId: playerId, state, myTurn: true });
  
  await E.msg(sock, jid, `${pMsg}\n\nWaiting for opponent...`);
  
  const oppMsg = 
    `📨 **Opponent moved!**\n\n` +
    `🧍 You: ${E.hpBar(me.hp, me.max_hp)}\n` +
    `🧍 Them: ${E.hpBar(them.hp, them.max_hp)}\n\n` +
    `🔥 **YOUR TURN!**\n` +
    `/pvpattack /pvpheavy /pvpdefend /pvpheal /pvpspecial /pvpsurrender`;
  
  await E.msgPlayer(sock, opponentId, oppMsg);
}

async function endMatch(sock, state, winner) {
  const p1Won = winner === 'p1';
  const winnerId = p1Won ? state.p1.id : state.p2.id;
  const loserId = p1Won ? state.p2.id : state.p1.id;
  
  const cfg = R().game.pvp;
  const w = DB.getPlayer(winnerId);
  const l = DB.getPlayer(loserId);
  
  const eloChange = E.calcEloChange(w.elo, l.elo);
  
  // Update stats
  DB.updatePlayer(winnerId, { 
    elo: w.elo + eloChange.gain, 
    pvp_wins: w.pvp_wins + 1,
    last_pvp: new Date().toISOString(),
    hp: p1Won ? state.p1.hp : state.p2.hp
  });
  
  DB.updatePlayer(loserId, { 
    elo: Math.max(100, l.elo - eloChange.loss), 
    pvp_losses: l.pvp_losses + 1,
    last_pvp: new Date().toISOString(),
    hp: 1
  });
  
  // Rewards
  E.giveOdds(winnerId, cfg.win_odds);
  E.giveXP(winnerId, cfg.win_xp);
  
  // Cleanup
  activePvp.delete(winnerId);
  activePvp.delete(loserId);
  
  // Messages
  const winMsg = 
    `🏆 **VICTORY!**\n\n` +
    `Defeated: **${l.name}**\n` +
    `ELO: ${w.elo} → **${w.elo + eloChange.gain}** (+${eloChange.gain})\n` +
    `🪙 +${cfg.win_odds}  ⭐ +${cfg.win_xp}`;
    
  const loseMsg = 
    `💀 **DEFEAT**\n\n` +
    `Lost to: **${w.name}**\n` +
    `ELO: ${l.elo} → **${Math.max(100, l.elo - eloChange.loss)}** (-${eloChange.loss})\n` +
    `You wake up with 1 HP.`;
  
  await E.msgPlayer(sock, winnerId, winMsg);
  await E.msgPlayer(sock, loserId, loseMsg);
}

async function spectate(sock, jid, watcherId, targetId) {
  // Future feature: watch live PvP matches
  await E.msg(sock, jid, '🔭 Spectator mode coming soon!');
}

module.exports = { joinQueue, leaveQueue, doAction, spectate };
