'use strict';

const DB = require('../core/database');
const E  = require('../core/gameEngine');

async function createTournament(sock, jid, adminId, name, minsBefore = 60) {
  const startsAt = new Date(Date.now() + minsBefore * 60000).toISOString();
  const tid = DB.db.prepare('INSERT INTO tournaments (name,starts_at) VALUES(?,?)').run(name || 'Weekly Tournament', startsAt).lastInsertRowid;

  const players = DB.db.prepare('SELECT id FROM players WHERE is_banned=0').all();
  const msg =
    `🏆 *TOURNAMENT ANNOUNCED!*\n\n` +
    `**${name || 'Weekly Tournament'}**\n` +
    `Starts in **${minsBefore} minutes**!\n\n` +
    `/tournament signup — Enter!\n\n` +
    `🥇 1st: 10,000🪙 + 20💎\n` +
    `🥈 2nd: 5,000🪙 + 10💎\n` +
    `🥉 3rd: 2,000🪙 + 5💎`;

  for (const p of players) await E.msgPlayer(sock, p.id, msg).catch(() => {});
  return tid;
}

async function signupTournament(sock, jid, playerId) {
  const t = DB.db.prepare("SELECT * FROM tournaments WHERE status='signup' ORDER BY created_at DESC LIMIT 1").get();
  if (!t) return E.msg(sock, jid, '❌ No tournament signup open right now.');

  try {
    DB.db.prepare('INSERT INTO tournament_entries (tournament_id,player_id) VALUES(?,?)').run(t.id, playerId);
    const count = DB.db.prepare('SELECT COUNT(*) as c FROM tournament_entries WHERE tournament_id=?').get(t.id).c;
    await E.msg(sock, jid, `✅ Signed up for **${t.name}**! (${count} players entered)`);
  } catch (_) {
    await E.msg(sock, jid, '❌ Already signed up!');
  }
}

async function startTournament(sock, tournamentId) {
  const t = DB.db.prepare('SELECT * FROM tournaments WHERE id=?').get(tournamentId);
  const entries = DB.db.prepare('SELECT player_id FROM tournament_entries WHERE tournament_id=?').all(tournamentId).map(r => r.player_id);
  if (entries.length < 2) { DB.db.prepare("UPDATE tournaments SET status='cancelled' WHERE id=?").run(tournamentId); return; }

  let players = [...entries].sort(() => Math.random() - 0.5);
  const n = Math.pow(2, Math.ceil(Math.log2(players.length)));
  while (players.length < n) players.push('BYE');

  const matches = [];
  for (let i = 0; i < players.length; i += 2) {
    matches.push({ p1: players[i], p2: players[i+1], winner: players[i+1] === 'BYE' ? players[i] : null });
  }

  const bracket = { rounds: [{ round: 1, matches }] };
  DB.db.prepare("UPDATE tournaments SET status='active', bracket=?, round=1 WHERE id=?").run(JSON.stringify(bracket), tournamentId);

  for (const pid of entries) {
    const match = matches.find(m => m.p1 === pid || m.p2 === pid);
    const opp   = match?.p1 === pid ? match.p2 : match?.p1;
    const oppP  = opp !== 'BYE' ? DB.getPlayer(opp) : null;
    await E.msgPlayer(sock, pid,
      `⚔️ *${t.name} Started!*\n\n` +
      `Round 1 opponent: **${oppP?.name || 'BYE (auto advance)'}**\n` +
      (opp !== 'BYE' ? `Use /ranked to fight! Tournament match counts.` : `You auto-advance!`)
    ).catch(() => {});
  }
}

async function showTournament(sock, jid, playerId) {
  const t = DB.db.prepare("SELECT * FROM tournaments WHERE status IN ('signup','active') ORDER BY created_at DESC LIMIT 1").get();
  if (!t) return E.msg(sock, jid, '❌ No active tournament. Admins announce them.');

  const count    = DB.db.prepare('SELECT COUNT(*) as c FROM tournament_entries WHERE tournament_id=?').get(t.id).c;
  const enrolled = !!DB.db.prepare('SELECT 1 FROM tournament_entries WHERE tournament_id=? AND player_id=?').get(t.id, playerId);

  let msg =
    `🏆 *${t.name}*\n` +
    `Status: **${t.status.toUpperCase()}**\n` +
    `Players: **${count}**\n` +
    `You: **${enrolled ? '✅ Entered' : '❌ Not entered'}**\n\n`;

  if (t.status === 'signup') {
    msg += `/tournament signup — Enter!`;
  } else {
    const bracket = JSON.parse(t.bracket);
    const current = bracket.rounds[t.round - 1];
    msg += `*Round ${t.round} Matches:*\n`;
    for (const m of current.matches) {
      const p1 = m.p1 === 'BYE' ? 'BYE' : DB.getPlayer(m.p1)?.name || m.p1;
      const p2 = m.p2 === 'BYE' ? 'BYE' : DB.getPlayer(m.p2)?.name || m.p2;
      const res = m.winner ? `→ ${DB.getPlayer(m.winner)?.name || m.winner} wins` : 'Pending';
      msg += `${p1} vs ${p2} — ${res}\n`;
    }
  }
  await E.msg(sock, jid, msg);
}

module.exports = { createTournament, signupTournament, startTournament, showTournament };
