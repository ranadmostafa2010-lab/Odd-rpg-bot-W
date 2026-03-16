'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const EVENTS = [
  { 
    id: 'double_odds', 
    name: 'Gold Rush', 
    emoji: '🪙', 
    desc: '2x Odds from all battles!',
    effect: { odds_multiplier: 2.0 },
    duration_hours: 2
  },
  { 
    id: 'double_xp', 
    name: 'Wisdom Week', 
    emoji: '📚', 
    desc: '2x XP from all sources!',
    effect: { xp_multiplier: 2.0 },
    duration_hours: 3
  },
  { 
    id: 'cheap_crates', 
    name: 'Merchant Festival', 
    emoji: '🎁', 
    desc: '50% off all crates!',
    effect: { crate_discount_pct: 50 },
    duration_hours: 4
  },
  { 
    id: 'lucky_steal', 
    name: 'Thieves Guild', 
    emoji: '🎭', 
    desc: 'Steal success rate +25%!',
    effect: { steal_success_bonus: 25 },
    duration_hours: 2
  },
  { 
    id: 'boss_invasion', 
    name: 'Boss Invasion', 
    emoji: '👹', 
    desc: 'Random boss chance doubled!',
    effect: { boss_chance_bonus: 100 },
    duration_hours: 1
  }
];

// ── Show current event ─────────────────────────────────────────────
async function showEvent(sock, jid) {
  const current = DB.db.prepare('SELECT * FROM world_events WHERE id=1').get();
  
  if (!current || new Date(current.ends_at) < new Date()) {
    return E.msg(sock, jid, '🌍 No active world event. Events happen hourly!\n\nPossible events:\n• Gold Rush (2x Odds)\n• Wisdom Week (2x XP)\n• Merchant Festival (50% off crates)\n• Thieves Guild (+steal chance)\n• Boss Invasion (more bosses)');
  }
  
  const event = EVENTS.find(e => e.id === current.event_id);
  if (!event) return E.msg(sock, jid, '❌ Event data error.');
  
  const hoursLeft = Math.max(0, Math.ceil((new Date(current.ends_at) - Date.now()) / 3600000));
  
  await E.msg(sock, jid,
    `🌍 *World Event Active!*\n\n` +
    `${event.emoji} **${event.name}**\n` +
    `_${event.desc}_\n\n` +
    `Time remaining: **${hoursLeft}h**`
  );
}

// ── Fire random event (called by scheduler) ────────────────────────
async function fireEvent(sock) {
  // 30% chance of event each hour
  if (Math.random() > 0.3) {
    console.log('[event] No event this hour');
    return;
  }
  
  const event = EVENTS[Math.floor(Math.random() * EVENTS.length)];
  const endsAt = new Date(Date.now() + event.duration_hours * 3600000).toISOString();
  
  DB.db.prepare('INSERT OR REPLACE INTO world_events (id, event_id, ends_at, effect) VALUES (1, ?, ?, ?)')
    .run(event.id, endsAt, JSON.stringify(event.effect));
  
  // Notify all players
  const players = DB.db.prepare("SELECT id FROM players WHERE is_banned=0 AND last_login > datetime('now','-3 days')").all();
  for (const p of players) {
    await E.msgPlayer(sock, p.id,
      `🌍 *WORLD EVENT STARTED!*\n\n` +
      `${event.emoji} **${event.name}**\n` +
      `_${event.desc}_\n\n` +
      `Duration: **${event.duration_hours} hours**\n` +
      `/event — Check details`
    ).catch(() => {});
  }
  
  console.log(`[event] Started: ${event.name}`);
}

// ── Get bonus value ─────────────────────────────────────────────────
function getBonus(type) {
  const current = DB.db.prepare('SELECT * FROM world_events WHERE id=1').get();
  if (!current) return null;
  
  if (new Date(current.ends_at) < new Date()) return null;
  
  try {
    const effect = JSON.parse(current.effect);
    return effect[type] || null;
  } catch {
    return null;
  }
}

module.exports = { showEvent, fireEvent, getBonus };
