'use strict';

const DB   = require('../core/database');
const E    = require('../core/gameEngine');
const R    = require('../registry');
const BM   = require('../core/battleManager');

// ── Create party ──────────────────────────────────────────────
async function createParty(sock, jid, leaderId, dungeonId) {
  const dungeon = R.dungeon(dungeonId);
  if (!dungeon) {
    const list = R().dungeons.map(d => `${d.emoji} **${d.id}** (Lv.${d.min_level}+)`).join('\n');
    return E.msg(sock, jid, `🏰 *Available Dungeons:*\n\n${list}\n\n/dungeon [id] to create a party`);
  }

  const player = DB.getPlayer(leaderId);
  if (player.level < dungeon.min_level) return E.msg(sock, jid, `❌ Need Level **${dungeon.min_level}** for this dungeon. (You: ${player.level})`);

  const inParty = DB.db.prepare("SELECT 1 FROM dungeon_parties WHERE status IN ('forming','active') AND members LIKE ?").get(`%${leaderId}%`);
  if (inParty) return E.msg(sock, jid, '❌ Already in a dungeon party!');

  const pid = DB.db.prepare('INSERT INTO dungeon_parties (dungeon_id,leader_id,members) VALUES(?,?,?)').run(dungeonId, leaderId, JSON.stringify([leaderId])).lastInsertRowid;

  await E.msg(sock, jid,
    `🏰 *Party Created!*\n\n` +
    `${dungeon.emoji} **${dungeon.name}**\n` +
    `Party ID: **${pid}** | 1/${dungeon.max_party}\n\n` +
    `/dungeon invite [number] — Invite players\n` +
    `/dungeon start — Start solo or with party`
  );
}

// ── Invite ────────────────────────────────────────────────────
async function inviteToParty(sock, jid, leaderId, targetRaw) {
  const party = DB.db.prepare("SELECT * FROM dungeon_parties WHERE leader_id=? AND status='forming'").get(leaderId);
  if (!party) return E.msg(sock, jid, '❌ No forming party. Create one with /dungeon [id]');

  const targetId = (targetRaw || '').replace(/\D/g,'');
  const target   = DB.getPlayer(targetId);
  if (!target) return E.msg(sock, jid, '❌ Player not found.');

  const members = JSON.parse(party.members);
  const dungeon  = R.dungeon(party.dungeon_id);
  if (members.length >= (dungeon?.max_party || 3)) return E.msg(sock, jid, '❌ Party full!');
  if (members.includes(targetId)) return E.msg(sock, jid, '❌ Already in party.');

  // Store invite in trades table
  const exp = new Date(Date.now() + 5 * 60000).toISOString();
  DB.db.prepare("INSERT OR REPLACE INTO trades (from_player,to_player,offer_type,offer_amount,expires_at) VALUES (?,?,'dungeon_invite',?,?)").run(leaderId, targetId, party.id, exp);

  await E.msg(sock, jid, `📨 Invite sent to **${target.name}**!`);
  await E.msgPlayer(sock, targetId,
    `📨 *Dungeon Invite!*\n\n**${DB.getPlayer(leaderId)?.name}** invites you to\n${dungeon?.emoji} **${dungeon?.name}**\n\n/dungeon join ${party.id} — Accept`
  );
}

// ── Join ──────────────────────────────────────────────────────
async function joinParty(sock, jid, playerId, partyIdStr) {
  const partyId = parseInt(partyIdStr);
  const party   = DB.db.prepare("SELECT * FROM dungeon_parties WHERE id=? AND status='forming'").get(partyId);
  if (!party) return E.msg(sock, jid, '❌ Party not found or already started.');

  const members = JSON.parse(party.members);
  if (members.includes(playerId)) return E.msg(sock, jid, '❌ Already in party.');
  const dungeon = R.dungeon(party.dungeon_id);
  if (members.length >= (dungeon?.max_party || 3)) return E.msg(sock, jid, '❌ Party full!');

  members.push(playerId);
  DB.db.prepare('UPDATE dungeon_parties SET members=? WHERE id=?').run(JSON.stringify(members), partyId);

  await E.msg(sock, jid, `🏰 Joined party! (${members.length}/${dungeon?.max_party || 3})`);
  await E.msgPlayer(sock, party.leader_id, `✅ **${DB.getPlayer(playerId)?.name}** joined the dungeon party!`);
}

// ── Start dungeon ─────────────────────────────────────────────
async function startDungeon(sock, jid, leaderId) {
  const party = DB.db.prepare("SELECT * FROM dungeon_parties WHERE leader_id=? AND status='forming'").get(leaderId);
  if (!party) return E.msg(sock, jid, '❌ No forming party. Use /dungeon [id] to create one.');

  const dungeon = R.dungeon(party.dungeon_id);
  if (!dungeon) return E.msg(sock, jid, '❌ Dungeon data not found.');

  const members    = JSON.parse(party.members);
  const memberData = {};
  for (const mid of members) {
    const p = DB.getPlayer(mid);
    memberData[mid] = { name: p.name, hp: p.max_hp, max_hp: p.max_hp, attack: p.attack, defense: p.defense };
  }

  const floor1   = dungeon.floors[0];
  const enemies  = buildFloorEnemies(floor1);
  const state    = { member_data: memberData, enemies, floor: 1, turn_idx: 0, turn: 1 };

  DB.db.prepare("UPDATE dungeon_parties SET status='active', current_floor=1, battle_data=? WHERE id=?").run(JSON.stringify(state), party.id);

  const msg = buildFloorMsg(dungeon, state, party.id);
  for (const mid of members) await E.msgPlayer(sock, mid, msg).catch(() => {});
}

// ── Dungeon action ────────────────────────────────────────────
async function dungeonAction(sock, jid, playerId, action) {
  const party = DB.db.prepare("SELECT * FROM dungeon_parties WHERE status='active' AND members LIKE ?").get(`%${playerId}%`);
  if (!party) return E.msg(sock, jid, '❌ Not in an active dungeon.');

  const state   = JSON.parse(party.battle_data);
  const members = JSON.parse(party.members);
  const dungeon = R.dungeon(party.dungeon_id);

  // Check turn
  const currentTurnPlayer = members[state.turn_idx % members.length];
  if (currentTurnPlayer !== playerId) {
    const name = state.member_data[currentTurnPlayer]?.name;
    return E.msg(sock, jid, `⏳ Not your turn! Waiting for **${name}**.`);
  }

  const me    = state.member_data[playerId];
  const enemy = state.enemies[0];
  let   pMsg  = '';

  switch (action) {
    case 'dattack': {
      const res = E.calcDamage(me.attack, 'attack');
      enemy.hp -= res.dmg;
      pMsg = `⚔️ ${me.name} hits ${enemy.name} for **${res.dmg}**!`;
      break;
    }
    case 'dheavy': {
      const res = E.calcDamage(me.attack, 'heavy_attack');
      if (res.missed) { pMsg = `⚔️ ${me.name}'s heavy attack missed!`; }
      else { enemy.hp -= res.dmg; pMsg = `🪓 ${me.name} heavy attacks for **${res.dmg}**!`; }
      break;
    }
    case 'dheal': {
      const h = Math.floor(me.max_hp * 0.25);
      me.hp   = Math.min(me.max_hp, me.hp + h);
      pMsg    = `💚 ${me.name} heals for **${h}** HP!`;
      break;
    }
    case 'dflee': {
      DB.db.prepare("UPDATE dungeon_parties SET status='abandoned' WHERE id=?").run(party.id);
      await E.msg(sock, jid, '🏃 You fled the dungeon!');
      for (const mid of members) if (mid !== playerId) await E.msgPlayer(sock, mid, `🏃 ${me.name} fled the dungeon. Party disbanded.`).catch(() => {});
      return;
    }
  }

  // Check enemy dead
  if (enemy.hp <= 0) {
    state.enemies.shift();

    if (!state.enemies.length) {
      const nextFloor = party.current_floor + 1;
      if (nextFloor > dungeon.floors.length) {
        // Dungeon complete!
        DB.db.prepare("UPDATE dungeon_parties SET status='complete' WHERE id=?").run(party.id);
        return await completeDungeon(sock, dungeon, members, state);
      }
      const nextFloorData = dungeon.floors[nextFloor - 1];
      state.enemies  = buildFloorEnemies(nextFloorData);
      state.floor    = nextFloor;
      state.turn_idx = 0;
      DB.db.prepare('UPDATE dungeon_parties SET current_floor=?, battle_data=? WHERE id=?').run(nextFloor, JSON.stringify(state), party.id);
      const floorMsg = `${pMsg}\n\n✅ Floor ${nextFloor-1} cleared!\n\n${buildFloorMsg(dungeon, state, party.id)}`;
      for (const mid of members) await E.msgPlayer(sock, mid, floorMsg).catch(() => {});
      return;
    }
  }

  // All members take enemy hit
  if (enemy.hp > 0) {
    for (const mid of members) {
      const m   = state.member_data[mid];
      const dmg = Math.max(1, enemy.attack - Math.floor(m.defense * 0.5));
      m.hp -= dmg;
      if (m.hp <= 0) m.hp = 1;
    }
  }

  state.turn_idx++;
  state.turn++;
  DB.db.prepare('UPDATE dungeon_parties SET battle_data=? WHERE id=?').run(JSON.stringify(state), party.id);

  const updateMsg = `${pMsg}\n\n${buildFloorMsg(dungeon, state, party.id)}`;
  for (const mid of members) await E.msgPlayer(sock, mid, updateMsg).catch(() => {});
}

async function completeDungeon(sock, dungeon, members, state) {
  const rewards = dungeon.rewards;
  for (const mid of members) {
    E.giveOdds(mid, rewards.odds_per_player);
    E.giveGems(mid, rewards.gems_per_player);
    E.giveXP(mid, rewards.xp_per_player);
    DB.updatePlayer(mid, { dungeons_cleared: (DB.getPlayer(mid)?.dungeons_cleared || 0) + 1 });

    let petMsg = '';
    if (rewards.pet_drop && E.roll(rewards.pet_drop.chance_pct)) {
      DB.addPet(mid, rewards.pet_drop.pet_id);
      const p = R.pet(rewards.pet_drop.pet_id);
      petMsg = `\n🐾 **PET DROP!** ${p?.emoji} ${p?.name}!`;
    }

    await E.msgPlayer(sock, mid,
      `🏆 *DUNGEON COMPLETE!*\n\n${dungeon.emoji} **${dungeon.name}**\n\n` +
      `🪙 +${E.fmt(rewards.odds_per_player)} Odds\n` +
      `💎 +${rewards.gems_per_player} Gems\n` +
      `⭐ +${E.fmt(rewards.xp_per_player)} XP` + petMsg
    ).catch(() => {});
  }
}

function buildFloorEnemies(floorData) {
  if (floorData.is_boss) {
    const b = floorData.boss;
    return [{ id: b.id, name: b.name, emoji: b.emoji, hp: b.hp, max_hp: b.hp, attack: b.attack, defense: b.defense }];
  }
  const out = [];
  for (const entry of floorData.enemies) {
    const e = R.enemy(entry.id);
    if (e) for (let i = 0; i < entry.count; i++) {
      out.push({ id: e.id, name: e.name, emoji: e.emoji, hp: e.base_hp, max_hp: e.base_hp, attack: e.base_attack, defense: e.base_defense || 0 });
    }
  }
  return out;
}

function buildFloorMsg(dungeon, state, partyId) {
  const members = JSON.parse(DB.db.prepare('SELECT members FROM dungeon_parties WHERE id=?').get(partyId)?.members || '[]');
  let msg = `🏰 **${dungeon.name}** — Floor ${state.floor}/${dungeon.floors.length}\n\n*Party:*\n`;
  for (const [mid, m] of Object.entries(state.member_data)) {
    msg += `🧍 ${m.name}: ${E.hpBar(m.hp, m.max_hp)}\n`;
  }
  msg += `\n*Enemies:*\n`;
  for (const e of state.enemies) {
    msg += `${e.emoji} ${e.name}: ${E.hpBar(e.hp, e.max_hp)}\n`;
  }
  const current = members[state.turn_idx % members.length];
  const cName   = state.member_data[current]?.name;
  msg += `\n⚡ **${cName}'s turn!**\n/dattack  /dheavy  /dheal  /dflee`;
  return msg;
}

module.exports = { createParty, inviteToParty, joinParty, startDungeon, dungeonAction };
