// ════════════════════════════════════════════════════════════
//  security.js  —  Rate limiting, flood protection, sanitizers
//  Every command passes through here before touching any data.
// ════════════════════════════════════════════════════════════
'use strict';

// Rate limits in milliseconds per action
const LIMITS = {
  default:  1500,
  battle:   2000,
  pvp:      3000,
  casino:   3000,
  steal:    1_800_000,   // 30 min
  daily:    72_000_000,  // 20 hrs
  breed:    86_400_000,  // 24 hrs
  raid:     30_000,
};

const rateMap  = new Map(); // { playerId: { action: timestamp } }
const floodMap = new Map(); // { playerId: { msgs: [], blocked_until: 0 } }

const FLOOD_WINDOW = 5000;
const FLOOD_MAX    = 10;
const FLOOD_BLOCK  = 30000;

// ── Rate limiter ─────────────────────────────────────────────
function checkRate(playerId, action = 'default') {
  const now    = Date.now();
  const limit  = LIMITS[action] || LIMITS.default;
  if (!rateMap.has(playerId)) rateMap.set(playerId, {});
  const m    = rateMap.get(playerId);
  const last = m[action] || 0;
  if (now - last < limit) return { ok: false, wait: limit - (now - last) };
  m[action] = now;
  return { ok: true, wait: 0 };
}

// ── Flood protection ─────────────────────────────────────────
function isFlooding(playerId) {
  const now = Date.now();
  if (!floodMap.has(playerId)) floodMap.set(playerId, { msgs: [], blocked_until: 0 });
  const d = floodMap.get(playerId);
  if (d.blocked_until > now) return true;
  d.msgs = d.msgs.filter(t => now - t < FLOOD_WINDOW);
  d.msgs.push(now);
  if (d.msgs.length >= FLOOD_MAX) {
    d.blocked_until = now + FLOOD_BLOCK;
    d.msgs = [];
    return true;
  }
  return false;
}

// ── Input sanitizers ─────────────────────────────────────────

/** Strip non-digits, validate length */
function cleanNumber(input) {
  if (!input) return null;
  const n = String(input).replace(/\D/g, '');
  return (n.length >= 7 && n.length <= 15) ? n : null;
}

/** Safe name — allow letters, numbers, basic symbols */
function cleanName(input, max = 20) {
  if (!input) return null;
  const s = String(input).replace(/[^\w\s\-.!?]/g, '').trim().slice(0, max);
  return s.length >= 2 ? s : null;
}

/** Safe message text */
function cleanText(input, max = 500) {
  if (!input) return '';
  return String(input).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, max);
}

/** Parse integer in range */
function cleanInt(input, min = 1, max = 999_999_999) {
  const n = parseInt(String(input || '').replace(/\D/g, '') || '0', 10);
  return (isNaN(n) || n < min || n > max) ? null : n;
}

/** Safe ID — alphanumeric + underscore + dash only */
function cleanId(input, max = 50) {
  if (!input) return null;
  const s = String(input).replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, max);
  return s.length >= 1 ? s : null;
}

// ── Memory cleanup ────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, m] of rateMap) {
    if (Object.values(m).every(t => now - t > 7_200_000)) rateMap.delete(id);
  }
  for (const [id, d] of floodMap) {
    if (d.blocked_until < now && !d.msgs.length) floodMap.delete(id);
  }
}, 3_600_000);

module.exports = { checkRate, isFlooding, cleanNumber, cleanName, cleanText, cleanInt, cleanId };
