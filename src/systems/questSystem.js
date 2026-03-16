'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const DAILY_QUESTS = [
  { id: 'win_3_pve', name: 'Monster Slayer', desc: 'Win 3 PvE battles', type: 'pve_wins', target: 3, reward_odds: 1000, reward_gems: 1 },
  { id: 'earn_5k', name: 'Treasure Hunter', desc: 'Earn 5,000 Odds', type: 'odds_earned', target: 5000, reward_odds: 500, reward_gems: 2 },
  { id: 'kill_boss', name: 'Boss Hunter', desc: 'Defeat 1 boss', type: 'boss_kills', target: 1, reward_odds: 2000, reward_gems: 3 },
  { id: 'open_3_crates', name: 'Crate Opener', desc: 'Open 3 crates', type: 'crate_open', target: 3, reward_odds: 800, reward_gems: 1 },
  { id: 'trade_once', name: 'Merchant', desc: 'Complete 1 trade', type: 'trade_complete', target: 1, reward_odds: 500, reward_gems: 1 }
];

// ── Show quests ─────────────────────────────────────────────────
async function show(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const today = new Date().toISOString().split('T')[0];
  
  // Ensure quests exist for today
  ensureDailyQuests(playerId, today);
  
  const quests = DB.db.prepare("SELECT * FROM player_quests WHERE player_id=? AND period='daily' AND reset_at=?").all(playerId, today);
  
  let msg = `📜 *Daily Quests*\n\n`;
  msg += `Resets at midnight UTC\n\n`;
  
  let allComplete = true;
  for (const q of quests) {
    const template = DAILY_QUESTS.find(dq => dq.id === q.quest_id);
    if (!template) continue;
    
    const status = q.completed ? (q.claimed ? '✅ Claimed' : '🎁 Ready!') : `⏳ ${q.progress}/${q.target}`;
    msg += `**${template.name}**\n`;
    msg += `_${template.desc}_\n`;
    msg += `Reward: ${E.fmt(template.reward_odds)} 🪙 + ${template.reward_gems} 💎\n`;
    msg += `Status: ${status}\n\n`;
    
    if (!q.completed || !q.claimed) allComplete = false;
  }
  
  if (allComplete) {
    msg += `🎉 All quests completed! Come back tomorrow!`;
  } else {
    msg += `/quest claim — Claim completed rewards`;
  }
  
  await E.msg(sock, jid, msg);
}

// ── Claim rewards ───────────────────────────────────────────────
async function claim(sock, jid, playerId) {
  const today = new Date().toISOString().split('T')[0];
  const ready = DB.db.prepare("SELECT * FROM player_quests WHERE player_id=? AND period='daily' AND reset_at=? AND completed=1 AND claimed=0").all(playerId, today);
  
  if (!ready.length) return E.msg(sock, jid, '❌ No completed quests to claim. Check /quest');
  
  let totalOdds = 0;
  let totalGems = 0;
  
  for (const q of ready) {
    const template = DAILY_QUESTS.find(dq => dq.id === q.quest_id);
    if (!template) continue;
    
    totalOdds += template.reward_odds;
    totalGems += template.reward_gems;
    DB.db.prepare('UPDATE player_quests SET claimed=1 WHERE id=?').run(q.id);
  }
  
  E.giveOdds(playerId, totalOdds);
  E.giveGems(playerId, totalGems);
  
  await E.msg(sock, jid, 
    `🎁 *Quest Rewards Claimed!*\n\n` +
    `🪙 +${E.fmt(totalOdds)} Odds\n` +
    `💎 +${totalGems} Gems\n\n` +
    `Great work! Check /quest for more.`
  );
}

// ── Track progress ──────────────────────────────────────────────
async function track(playerId, type, amount) {
  const today = new Date().toISOString().split('T')[0];
  ensureDailyQuests(playerId, today);
  
  const quests = DB.db.prepare("SELECT * FROM player_quests WHERE player_id=? AND period='daily' AND reset_at=? AND completed=0").all(playerId, today);
  
  for (const q of quests) {
    const template = DAILY_QUESTS.find(dq => dq.id === q.quest_id);
    if (!template || template.type !== type) continue;
    
    const newProgress = Math.min(q.target, q.progress + amount);
    const completed = newProgress >= q.target ? 1 : 0;
    
    DB.db.prepare('UPDATE player_quests SET progress=?, completed=? WHERE id=?').run(newProgress, completed, q.id);
  }
}

// ── Ensure quests exist ─────────────────────────────────────────
function ensureDailyQuests(playerId, date) {
  const existing = DB.db.prepare("SELECT COUNT(*) as c FROM player_quests WHERE player_id=? AND period='daily' AND reset_at=?").get(playerId, date).c;
  if (existing > 0) return;
  
  // Pick 3 random quests for the day
  const selected = [...DAILY_QUESTS].sort(() => Math.random() - 0.5).slice(0, 3);
  
  for (const q of selected) {
    const resetAt = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
    DB.db.prepare('INSERT INTO player_quests (player_id, quest_id, type, target, period, reset_at) VALUES (?,?,?,?,?,?)')
      .run(playerId, q.id, q.type, q.target, 'daily', resetAt);
  }
}

module.exports = { show, claim, track };
