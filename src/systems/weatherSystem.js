'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const WEATHERS = [
  { id: 'sunny', name: 'Sunny', emoji: '☀️', effect: 'odds_multiplier', value: 1.0, desc: 'Normal conditions' },
  { id: 'rainy', name: 'Rainy', emoji: '🌧️', effect: 'crate_discount_pct', value: 10, desc: '10% off all crates' },
  { id: 'stormy', name: 'Stormy', emoji: '⛈️', effect: 'pvp_damage_bonus', value: 1.2, desc: '+20% PvP damage' },
  { id: 'foggy', name: 'Foggy', emoji: '🌫️', effect: 'steal_success_bonus', value: 15, desc: '+15% steal success' },
  { id: 'starry', name: 'Starry Night', emoji: '🌌', effect: 'xp_multiplier', value: 1.25, desc: '+25% XP from battles' },
  { id: 'bloody', name: 'Blood Moon', emoji: '🌕🩸', effect: 'boss_odds_bonus', value: 2.0, desc: '2x Odds from bosses' }
];

// ── Show current weather ───────────────────────────────────────────
async function showWeather(sock, jid) {
  const current = DB.db.prepare('SELECT * FROM current_weather WHERE id=1').get();
  
  if (!current) {
    await changeWeather(sock);
    return showWeather(sock, jid);
  }
  
  const weather = WEATHERS.find(w => w.id === current.weather_id) || WEATHERS[0];
  const hoursLeft = Math.max(0, Math.ceil((new Date(current.ends_at) - Date.now()) / 3600000));
  
  await E.msg(sock, jid,
    `🌤️ *Current Weather*\n\n` +
    `${weather.emoji} **${weather.name}**\n` +
    `_${weather.desc}_\n\n` +
    `Effect: **${weather.effect}** ${weather.value}x\n` +
    `Changes in: **${hoursLeft}h**`
  );
}

// ── Change weather (called by scheduler) ────────────────────────────
async function changeWeather(sock) {
  const weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
  const endsAt = new Date(Date.now() + 6 * 3600000).toISOString(); // 6 hours
  
  DB.db.prepare('INSERT OR REPLACE INTO current_weather (id, weather_id, ends_at) VALUES (1, ?, ?)').run(weather.id, endsAt);
  
  // Notify all online players
  const players = DB.db.prepare("SELECT id FROM players WHERE last_login > datetime('now','-15 minutes') AND is_banned=0").all();
  for (const p of players) {
    await E.msgPlayer(sock, p.id,
      `🌤️ *Weather Change!*\n\n` +
      `${weather.emoji} **${weather.name}** has arrived!\n` +
      `_${weather.desc}_\n\n` +
      `Effect active for 6 hours.`
    ).catch(() => {});
  }
}

// ── Get current bonus ───────────────────────────────────────────────
function getBonus(type) {
  const current = DB.db.prepare('SELECT * FROM current_weather WHERE id=1').get();
  if (!current) return null;
  
  const weather = WEATHERS.find(w => w.id === current.weather_id);
  if (!weather || weather.effect !== type) return null;
  
  return weather.value;
}

module.exports = { showWeather, changeWeather, getBonus };
