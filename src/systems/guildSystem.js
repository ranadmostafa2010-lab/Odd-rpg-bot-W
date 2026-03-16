'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const { cleanNumber, cleanName, cleanInt } = require('../core/security');

// ── Create guild ──────────────────────────────────────────────
async function createGuild(sock, jid, leaderId, nameRaw, tagRaw) {
  const player = DB.getPlayer(leaderId);
  const gCfg   = R().game.guild;

  const existing = DB.db.prepare('SELECT 1 FROM guild_members WHERE player_id=?').get(leaderId);
  if (existing) return E.msg(sock, jid, '❌ You\'re already in a guild. /guild leave first.');

  const name = cleanName(nameRaw, 20);
  if (!name) return E.msg(sock, jid, `❌ Guild name must be 2–20 characters.`);

  const tag = (tagRaw || name.slice(0,4)).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
  if (name.length < 3) return E.msg(sock, jid, '❌ Name too short (min 3 chars)');

  if (player.odds < gCfg.create_cost) return E.msg(sock, jid, `❌ Creating a guild costs **${E.fmt(gCfg.create_cost)} 🪙**.`);

  const dup = DB.db.prepare('SELECT 1 FROM guilds WHERE name=?').get(name);
  if (dup) return E.msg(sock, jid, `❌ Name "${name}" is taken.`);

  const gid = DB.db.prepare('INSERT INTO guilds (name,tag,leader_id) VALUES(?,?,?)').run(name, tag, leaderId).lastInsertRowid;
  DB.db.prepare('INSERT INTO guild_members (player_id,guild_id,rank) VALUES(?,?,?)').run(leaderId, gid, 'leader');
  E.takeOdds(leaderId, gCfg.create_cost);

  await E.msg(sock, jid, `🏰 *Guild Created!*\n\n**[${tag}] ${name}**\nYou are the Leader!\n\n/guild invite [number] — Invite players\n/guild menu — Manage`);
}

// ── Guild menu ────────────────────────────────────────────────
async function showGuildMenu(sock, jid, playerId) {
  const mem   = DB.db.prepare('SELECT * FROM guild_members WHERE player_id=?').get(playerId);
  if (!mem) return E.msg(sock, jid, `🏰 You are not in a guild.\n\n/guild create [name] [tag] — Create (${E.fmt(R().game.guild.create_cost)} 🪙)\n/guild list — Browse guilds`);

  const guild   = DB.db.prepare('SELECT * FROM guilds WHERE id=?').get(mem.guild_id);
  const members = DB.db.prepare('SELECT gm.*,p.name,p.level,p.elo FROM guild_members gm JOIN players p ON gm.player_id=p.id WHERE gm.guild_id=?').all(guild.id);
  const leader  = members.find(m => m.rank === 'leader');

  const rankIcon = { leader:'👑', officer:'⭐', veteran:'🔰', member:'👤' };

  let msg =
    `🏰 **[${guild.tag}] ${guild.name}** (Lv.${guild.level})\n` +
    `👥 ${members.length}/${R().game.guild.max_members_base} members\n` +
    `💰 Chest: ${E.fmt(guild.chest_odds)} 🪙\n` +
    `🏆 War Wins: ${guild.war_wins}\n\n` +
    `👑 Leader: ${leader?.name || '?'}\n\n*Members:*\n`;

  for (const m of members.sort((a,b) => b.contribution - a.contribution)) {
    msg += `${rankIcon[m.rank]||'👤'} ${m.name} (Lv.${m.level}) — ${E.fmt(m.contribution)} contributed\n`;
  }

  msg += `\n/guild invite [num]\n/guild leave\n/guild chest withdraw [amount]\n/guild war [name]`;
  await E.msg(sock, jid, msg);
}

// ── Invite ────────────────────────────────────────────────────
async function inviteToGuild(sock, jid, inviterId, targetRaw) {
  const mem  = DB.db.prepare('SELECT * FROM guild_members WHERE player_id=?').get(inviterId);
  if (!mem || !['leader','officer'].includes(mem.rank)) return E.msg(sock, jid, '❌ Only officers/leaders can invite.');

  const targetId = cleanNumber(targetRaw);
  if (!targetId) return E.msg(sock, jid, '❌ Invalid number.');

  const target = DB.getPlayer(targetId);
  if (!target) return E.msg(sock, jid, '❌ Player not found.');

  const already = DB.db.prepare('SELECT 1 FROM guild_members WHERE player_id=?').get(targetId);
  if (already) return E.msg(sock, jid, `❌ **${target.name}** is already in a guild.`);

  const guild = DB.db.prepare('SELECT * FROM guilds WHERE id=?').get(mem.guild_id);
  const count = DB.db.prepare('SELECT COUNT(*) as c FROM guild_members WHERE guild_id=?').get(mem.guild_id).c;
  if (count >= R().game.guild.max_members_base) return E.msg(sock, jid, '❌ Guild is full!');

  // Reuse trades table for invite
  const expires = new Date(Date.now() + 10 * 60000).toISOString();
  DB.db.prepare("INSERT OR REPLACE INTO trades (from_player,to_player,offer_type,offer_amount,expires_at) VALUES (?,?,'guild_invite',?,?)").run(inviterId, targetId, guild.id, expires);

  await E.msg(sock, jid, `📨 Invite sent to **${target.name}**!`);
  await E.msgPlayer(sock, targetId,
    `📨 *Guild Invite!*\n\n**${DB.getPlayer(inviterId)?.name}** invites you to\n🏰 **[${guild.tag}] ${guild.name}**\n\n/guild join — Accept\n/guild decline — Reject`
  );
}

// ── Join ──────────────────────────────────────────────────────
async function joinGuild(sock, jid, playerId) {
  const invite = DB.db.prepare("SELECT * FROM trades WHERE to_player=? AND offer_type='guild_invite' AND status='pending' ORDER BY created_at DESC LIMIT 1").get(playerId);
  if (!invite) return E.msg(sock, jid, '❌ No pending guild invite.');

  const guild = DB.db.prepare('SELECT * FROM guilds WHERE id=?').get(invite.offer_amount);
  if (!guild) return E.msg(sock, jid, '❌ Guild no longer exists.');

  DB.db.prepare('INSERT INTO guild_members (player_id,guild_id,rank) VALUES(?,?,?)').run(playerId, guild.id, 'member');
  DB.db.prepare("UPDATE trades SET status='accepted' WHERE id=?").run(invite.id);

  await E.msg(sock, jid, `🏰 You joined **[${guild.tag}] ${guild.name}**!`);
  await E.msgPlayer(sock, invite.from_player, `✅ **${DB.getPlayer(playerId)?.name}** joined the guild!`);
}

// ── Leave ─────────────────────────────────────────────────────
async function leaveGuild(sock, jid, playerId) {
  const mem = DB.db.prepare('SELECT * FROM guild_members WHERE player_id=?').get(playerId);
  if (!mem) return E.msg(sock, jid, '❌ You are not in a guild.');
  if (mem.rank === 'leader') return E.msg(sock, jid, '❌ Transfer leadership first: /guild transfer [number]');
  DB.db.prepare('DELETE FROM guild_members WHERE player_id=?').run(playerId);
  await E.msg(sock, jid, '✅ You left the guild.');
}

// ── Chest withdraw ────────────────────────────────────────────
async function withdrawChest(sock, jid, playerId, amtStr) {
  const mem   = DB.db.prepare('SELECT * FROM guild_members WHERE player_id=?').get(playerId);
  if (!mem || !['leader','officer'].includes(mem.rank)) return E.msg(sock, jid, '❌ Officers+ only.');

  const guild = DB.db.prepare('SELECT * FROM guilds WHERE id=?').get(mem.guild_id);
  const amt   = cleanInt(amtStr, 1, guild.chest_odds);
  if (!amt) return E.msg(sock, jid, `❌ Invalid amount. Chest has ${E.fmt(guild.chest_odds)} 🪙.`);

  DB.db.prepare('UPDATE guilds SET chest_odds=chest_odds-? WHERE id=?').run(amt, guild.id);
  E.giveOdds(playerId, amt);
  await E.msg(sock, jid, `✅ Withdrew **${E.fmt(amt)} 🪙** from guild chest.`);
}

// ── Declare war ───────────────────────────────────────────────
async function declareWar(sock, jid, playerId, targetGuildName) {
  const mem = DB.db.prepare('SELECT * FROM guild_members WHERE player_id=?').get(playerId);
  if (!mem || mem.rank !== 'leader') return E.msg(sock, jid, '❌ Only the guild leader can declare war.');

  const ourGuild  = DB.db.prepare('SELECT * FROM guilds WHERE id=?').get(mem.guild_id);
  const theirGuild = DB.db.prepare('SELECT * FROM guilds WHERE name=?').get(targetGuildName);

  if (!theirGuild) return E.msg(sock, jid, `❌ Guild "${targetGuildName}" not found.`);
  if (ourGuild.at_war_with) return E.msg(sock, jid, '❌ Already at war!');
  if (ourGuild.id === theirGuild.id) return E.msg(sock, jid, '❌ Cannot war yourself.');

  const ends = new Date(Date.now() + R().game.guild.war_duration_hours * 3600000).toISOString();
  DB.db.prepare('UPDATE guilds SET at_war_with=?,war_ends_at=?,war_points=0 WHERE id=?').run(theirGuild.id, ends, ourGuild.id);
  DB.db.prepare('UPDATE guilds SET at_war_with=?,war_ends_at=?,war_points=0 WHERE id=?').run(ourGuild.id, ends, theirGuild.id);

  const announcement = (a, b) =>
    `⚔️ *GUILD WAR!*\n\n[${a.tag}] **${a.name}** vs [${b.tag}] **${b.name}**\n\nDuration: ${R().game.guild.war_duration_hours}h\nWin PvP vs enemy members for war points!\n\n/guild info to check scores`;

  const allMembers = [...DB.db.prepare('SELECT player_id FROM guild_members WHERE guild_id=?').all(ourGuild.id),
                      ...DB.db.prepare('SELECT player_id FROM guild_members WHERE guild_id=?').all(theirGuild.id)];
  for (const m of allMembers) {
    await E.msgPlayer(sock, m.player_id, announcement(ourGuild, theirGuild)).catch(() => {});
  }
}

// ── Contribute to chest (auto-called from pveSystem victory) ──
function contributeToChest(guildId, amount) {
  DB.db.prepare('UPDATE guilds SET chest_odds=chest_odds+?, xp=xp+? WHERE id=?').run(amount, Math.floor(amount/10), guildId);
}

// ── Get player's guild ────────────────────────────────────────
function getPlayerGuild(playerId) {
  const mem = DB.db.prepare('SELECT * FROM guild_members WHERE player_id=?').get(playerId);
  if (!mem) return null;
  return { member: mem, guild: DB.db.prepare('SELECT * FROM guilds WHERE id=?').get(mem.guild_id) };
}

module.exports = { createGuild, showGuildMenu, inviteToGuild, joinGuild, leaveGuild, withdrawChest, declareWar, contributeToChest, getPlayerGuild };
