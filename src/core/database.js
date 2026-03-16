// ════════════════════════════════════════════════════════════
//  database.js  —  All tables, all helpers
//  Uses better-sqlite3 (synchronous = no race conditions)
// ════════════════════════════════════════════════════════════
'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_DIR  = path.join(__dirname, '../../database');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'rpg_bot.db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -16000');
db.pragma('temp_store = MEMORY');

// ════════════════════════════════════════════════════════════
//  CREATE TABLES
// ════════════════════════════════════════════════════════════
function initDatabase() {

  db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    level            INTEGER DEFAULT 1,
    xp               INTEGER DEFAULT 0,
    hp               INTEGER DEFAULT 100,
    max_hp           INTEGER DEFAULT 100,
    attack           INTEGER DEFAULT 15,
    defense          INTEGER DEFAULT 10,
    odds             INTEGER DEFAULT 500,
    gems             INTEGER DEFAULT 0,
    bank_balance     INTEGER DEFAULT 0,
    bank_tier        INTEGER DEFAULT 1,
    elo              INTEGER DEFAULT 1000,
    pvp_wins         INTEGER DEFAULT 0,
    pvp_losses       INTEGER DEFAULT 0,
    pve_wins         INTEGER DEFAULT 0,
    bosses_killed    INTEGER DEFAULT 0,
    dungeons_cleared INTEGER DEFAULT 0,
    total_odds_earned INTEGER DEFAULT 0,
    steal_successes  INTEGER DEFAULT 0,
    class            TEXT DEFAULT NULL,
    skill_points     INTEGER DEFAULT 0,
    prestige         INTEGER DEFAULT 0,
    prestige_badge   TEXT DEFAULT NULL,
    equipped_pet     TEXT DEFAULT NULL,
    title            TEXT DEFAULT NULL,
    story_world      TEXT DEFAULT 'forest',
    story_chapter    INTEGER DEFAULT 1,
    worlds_cleared   INTEGER DEFAULT 0,
    daily_streak     INTEGER DEFAULT 0,
    last_daily       TEXT DEFAULT NULL,
    last_daily_crate TEXT DEFAULT NULL,
    last_battle      TEXT DEFAULT NULL,
    last_pvp         TEXT DEFAULT NULL,
    last_steal       TEXT DEFAULT NULL,
    last_breed       TEXT DEFAULT NULL,
    last_login       TEXT DEFAULT NULL,
    offline_since    TEXT DEFAULT NULL,
    shield_expires   TEXT DEFAULT NULL,
    is_banned        INTEGER DEFAULT 0,
    ban_reason       TEXT DEFAULT NULL,
    ban_expires      TEXT DEFAULT NULL,
    warnings         INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS player_pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    pet_id    TEXT NOT NULL,
    obtained_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS inventory (
    player_id TEXT NOT NULL,
    item_id   TEXT NOT NULL,
    quantity  INTEGER DEFAULT 1,
    PRIMARY KEY(player_id, item_id),
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS materials (
    player_id   TEXT NOT NULL,
    material_id TEXT NOT NULL,
    quantity    INTEGER DEFAULT 0,
    PRIMARY KEY(player_id, material_id),
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS player_gear (
    player_id TEXT PRIMARY KEY,
    weapon_id TEXT DEFAULT NULL,
    armor_id  TEXT DEFAULT NULL,
    ring_id   TEXT DEFAULT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS player_skills (
    player_id TEXT NOT NULL,
    skill_id  TEXT NOT NULL,
    level     INTEGER DEFAULT 0,
    PRIMARY KEY(player_id, skill_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS player_achievements (
    player_id      TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(player_id, achievement_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS player_titles (
    player_id TEXT NOT NULL,
    title_id  TEXT NOT NULL,
    earned_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(player_id, title_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS player_quests (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    quest_id  TEXT NOT NULL,
    type      TEXT NOT NULL,
    progress  INTEGER DEFAULT 0,
    target    INTEGER NOT NULL,
    completed INTEGER DEFAULT 0,
    claimed   INTEGER DEFAULT 0,
    period    TEXT NOT NULL,
    reset_at  TEXT NOT NULL,
    UNIQUE(player_id, quest_id, reset_at),
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS active_battles (
    player_id   TEXT PRIMARY KEY,
    battle_type TEXT NOT NULL,
    battle_data TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS pvp_queue (
    player_id TEXT PRIMARY KEY,
    elo       INTEGER NOT NULL,
    queued_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS pvp_spectators (
    battle_id TEXT NOT NULL,
    watcher_id TEXT NOT NULL,
    PRIMARY KEY(battle_id, watcher_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS trades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    from_player  TEXT NOT NULL,
    to_player    TEXT NOT NULL,
    offer_type   TEXT NOT NULL,
    offer_amount INTEGER DEFAULT 0,
    offer_item   TEXT DEFAULT NULL,
    status       TEXT DEFAULT 'pending',
    created_at   TEXT DEFAULT (datetime('now')),
    expires_at   TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS guilds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    tag         TEXT NOT NULL,
    leader_id   TEXT NOT NULL,
    description TEXT DEFAULT 'A guild on the rise.',
    level       INTEGER DEFAULT 1,
    xp          INTEGER DEFAULT 0,
    chest_odds  INTEGER DEFAULT 0,
    war_wins    INTEGER DEFAULT 0,
    at_war_with INTEGER DEFAULT NULL,
    war_ends_at TEXT DEFAULT NULL,
    war_points  INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS guild_members (
    player_id    TEXT PRIMARY KEY,
    guild_id     INTEGER NOT NULL,
    rank         TEXT DEFAULT 'member',
    contribution INTEGER DEFAULT 0,
    joined_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(guild_id) REFERENCES guilds(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS dungeon_parties (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dungeon_id    TEXT NOT NULL,
    leader_id     TEXT NOT NULL,
    members       TEXT DEFAULT '[]',
    status        TEXT DEFAULT 'forming',
    current_floor INTEGER DEFAULT 1,
    battle_data   TEXT DEFAULT '{}',
    created_at    TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS auctions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id      TEXT NOT NULL,
    item_type      TEXT NOT NULL,
    item_id        TEXT NOT NULL,
    starting_bid   INTEGER NOT NULL,
    current_bid    INTEGER DEFAULT 0,
    current_bidder TEXT DEFAULT NULL,
    buyout_price   INTEGER DEFAULT 0,
    status         TEXT DEFAULT 'active',
    ends_at        TEXT NOT NULL,
    created_at     TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS tournaments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    status     TEXT DEFAULT 'signup',
    bracket    TEXT DEFAULT '{}',
    round      INTEGER DEFAULT 1,
    starts_at  TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS tournament_entries (
    tournament_id INTEGER NOT NULL,
    player_id     TEXT NOT NULL,
    PRIMARY KEY(tournament_id, player_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS active_raids (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    boss_id      TEXT NOT NULL,
    current_hp   INTEGER NOT NULL,
    max_hp       INTEGER NOT NULL,
    phase        INTEGER DEFAULT 1,
    participants TEXT DEFAULT '{}',
    status       TEXT DEFAULT 'active',
    started_at   TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS bounties (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id   TEXT NOT NULL,
    poster_id   TEXT NOT NULL,
    amount_odds INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'active',
    claimed_by  TEXT DEFAULT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS giveaways (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    prize_type   TEXT NOT NULL,
    prize_amount INTEGER DEFAULT 0,
    prize_item   TEXT DEFAULT NULL,
    entries      TEXT DEFAULT '[]',
    status       TEXT DEFAULT 'active',
    ends_at      TEXT NOT NULL,
    created_by   TEXT NOT NULL,
    created_at   TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS gem_vouchers (
    code        TEXT PRIMARY KEY,
    gems        INTEGER NOT NULL,
    created_by  TEXT NOT NULL,
    redeemed_by TEXT DEFAULT NULL,
    redeemed_at TEXT DEFAULT NULL,
    expires_at  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS current_weather (
    id         INTEGER PRIMARY KEY CHECK(id=1),
    weather_id TEXT NOT NULL,
    ends_at    TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS world_events (
    id       INTEGER PRIMARY KEY CHECK(id=1),
    event_id TEXT NOT NULL,
    ends_at  TEXT NOT NULL,
    effect   TEXT DEFAULT '{}'
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS admin_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id   TEXT NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT DEFAULT NULL,
    details    TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_players_elo   ON players(elo DESC);
    CREATE INDEX IF NOT EXISTS idx_players_level ON players(level DESC);
    CREATE INDEX IF NOT EXISTS idx_player_pets   ON player_pets(player_id);
    CREATE INDEX IF NOT EXISTS idx_battles       ON active_battles(player_id);
    CREATE INDEX IF NOT EXISTS idx_trades_to     ON trades(to_player, status);
    CREATE INDEX IF NOT EXISTS idx_guild_members ON guild_members(guild_id);
    CREATE INDEX IF NOT EXISTS idx_auctions      ON auctions(status, ends_at);
    CREATE INDEX IF NOT EXISTS idx_bounties      ON bounties(target_id, status);
    CREATE INDEX IF NOT EXISTS idx_quests        ON player_quests(player_id, period);
  `);

  _migrate();
  console.log('✅ Database ready.');
}

function _migrate() {
  const cols = [
    ['players','last_daily_crate','TEXT DEFAULT NULL'],
    ['players','last_breed',      'TEXT DEFAULT NULL'],
    ['players','ban_expires',     'TEXT DEFAULT NULL'],
    ['players','warnings',        'INTEGER DEFAULT 0'],
    ['players','worlds_cleared',  'INTEGER DEFAULT 0'],
    ['players','steal_successes', 'INTEGER DEFAULT 0'],
    ['players','dungeons_cleared','INTEGER DEFAULT 0'],
    ['players','prestige_badge',  'TEXT DEFAULT NULL'],
    ['players','title',           'TEXT DEFAULT NULL'],
  ];
  for (const [tbl, col, def] of cols) {
    try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); } catch (_) {}
  }
}

// ════════════════════════════════════════════════════════════
//  PLAYER HELPERS
// ════════════════════════════════════════════════════════════

const ALLOWED_PLAYER_FIELDS = new Set([
  'name','level','xp','hp','max_hp','attack','defense','odds','gems',
  'bank_balance','bank_tier','elo','pvp_wins','pvp_losses','pve_wins',
  'bosses_killed','dungeons_cleared','total_odds_earned','steal_successes',
  'class','skill_points','prestige','prestige_badge','equipped_pet','title',
  'story_world','story_chapter','worlds_cleared','daily_streak','last_daily',
  'last_daily_crate','last_battle','last_pvp','last_steal','last_breed',
  'last_login','offline_since','shield_expires','is_banned','ban_reason',
  'ban_expires','warnings',
]);

function getPlayer(id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id) || null;
}

function createPlayer(id, name, cfg) {
  db.prepare(`
    INSERT INTO players (id, name, odds, gems, hp, max_hp, attack, defense)
    VALUES (@id, @name, @odds, @gems, @hp, @max_hp, @attack, @defense)
  `).run({
    id, name,
    odds: cfg.starting_odds,   gems: cfg.starting_gems,
    hp:   cfg.starting_max_hp, max_hp: cfg.starting_max_hp,
    attack: cfg.starting_attack, defense: cfg.starting_defense,
  });
  return getPlayer(id);
}

function updatePlayer(id, fields) {
  const safe = {};
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED_PLAYER_FIELDS.has(k)) safe[k] = v;
  }
  if (!Object.keys(safe).length) return;
  const sets = Object.keys(safe).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE players SET ${sets} WHERE id = @_id`).run({ ...safe, _id: id });
}

// Atomic currency — prevents negative balance exploits
function addOdds(id, delta) {
  if (delta > 0) db.prepare('UPDATE players SET odds = odds + ?, total_odds_earned = total_odds_earned + ? WHERE id = ?').run(delta, delta, id);
  else           db.prepare('UPDATE players SET odds = MAX(0, odds + ?) WHERE id = ?').run(delta, id);
  return getPlayer(id)?.odds ?? 0;
}

function addGems(id, delta) {
  if (delta > 0) db.prepare('UPDATE players SET gems = gems + ? WHERE id = ?').run(delta, id);
  else           db.prepare('UPDATE players SET gems = MAX(0, gems + ?) WHERE id = ?').run(delta, id);
  return getPlayer(id)?.gems ?? 0;
}

// ════════════════════════════════════════════════════════════
//  INVENTORY / PETS / MATERIALS
// ════════════════════════════════════════════════════════════

function getPets(id)    { return db.prepare('SELECT * FROM player_pets WHERE player_id = ? ORDER BY id').all(id); }
function hasPet(id, pid){ return !!db.prepare('SELECT 1 FROM player_pets WHERE player_id=? AND pet_id=?').get(id,pid); }
function addPet(id, pid){ db.prepare('INSERT INTO player_pets (player_id, pet_id) VALUES (?,?)').run(id, pid); }
function removePet(id, pid){
  db.prepare('DELETE FROM player_pets WHERE player_id=? AND pet_id=? LIMIT 1').run(id, pid);
}

function getInv(id) { return db.prepare('SELECT * FROM inventory WHERE player_id=?').all(id); }
function hasItem(id, item, qty = 1) {
  const r = db.prepare('SELECT quantity FROM inventory WHERE player_id=? AND item_id=?').get(id, item);
  return r ? r.quantity >= qty : false;
}
function addItem(id, item, qty = 1) {
  db.prepare('INSERT INTO inventory (player_id,item_id,quantity) VALUES(?,?,?) ON CONFLICT(player_id,item_id) DO UPDATE SET quantity=quantity+excluded.quantity').run(id, item, qty);
}
function removeItem(id, item, qty = 1) {
  const r = db.prepare('SELECT quantity FROM inventory WHERE player_id=? AND item_id=?').get(id, item);
  if (!r || r.quantity < qty) return false;
  if (r.quantity === qty) db.prepare('DELETE FROM inventory WHERE player_id=? AND item_id=?').run(id, item);
  else db.prepare('UPDATE inventory SET quantity=quantity-? WHERE player_id=? AND item_id=?').run(qty, id, item);
  return true;
}

function getMats(id) { return db.prepare('SELECT * FROM materials WHERE player_id=?').all(id); }
function hasMat(id, mat, qty = 1) {
  const r = db.prepare('SELECT quantity FROM materials WHERE player_id=? AND material_id=?').get(id, mat);
  return r ? r.quantity >= qty : false;
}
function addMat(id, mat, qty = 1) {
  db.prepare('INSERT INTO materials (player_id,material_id,quantity) VALUES(?,?,?) ON CONFLICT(player_id,material_id) DO UPDATE SET quantity=quantity+excluded.quantity').run(id, mat, qty);
}
function removeMat(id, mat, qty = 1) {
  const r = db.prepare('SELECT quantity FROM materials WHERE player_id=? AND material_id=?').get(id, mat);
  if (!r || r.quantity < qty) return false;
  if (r.quantity === qty) db.prepare('DELETE FROM materials WHERE player_id=? AND material_id=?').run(id, mat);
  else db.prepare('UPDATE materials SET quantity=quantity-? WHERE player_id=? AND material_id=?').run(qty, id, mat);
  return true;
}

// ════════════════════════════════════════════════════════════
//  BATTLE
// ════════════════════════════════════════════════════════════

function saveBattle(pid, type, data) {
  db.prepare(`INSERT INTO active_battles (player_id,battle_type,battle_data) VALUES(?,?,?)
    ON CONFLICT(player_id) DO UPDATE SET battle_type=excluded.battle_type, battle_data=excluded.battle_data, created_at=datetime('now')`).run(pid, type, JSON.stringify(data));
}
function getBattle(pid) {
  const r = db.prepare('SELECT * FROM active_battles WHERE player_id=?').get(pid);
  if (!r) return null;
  try { return { ...r, data: JSON.parse(r.battle_data) }; }
  catch (_) { clearBattle(pid); return null; }
}
function clearBattle(pid) { db.prepare('DELETE FROM active_battles WHERE player_id=?').run(pid); }

// ════════════════════════════════════════════════════════════
//  LEADERBOARD + ADMIN LOG + CLEANUP
// ════════════════════════════════════════════════════════════

function getLeaderboard(col, limit = 10) {
  const SAFE = new Set(['elo','level','odds','pvp_wins','pve_wins','bosses_killed','total_odds_earned','prestige']);
  if (!SAFE.has(col)) col = 'elo';
  return db.prepare(`SELECT id,name,prestige_badge,${col} as value FROM players WHERE is_banned=0 ORDER BY ${col} DESC LIMIT ?`).all(limit);
}

function logAdmin(adminId, action, target, details) {
  db.prepare('INSERT INTO admin_logs (admin_id,action,target,details) VALUES(?,?,?,?)').run(adminId, action, target||null, details ? String(details).slice(0,200) : null);
}

function cleanExpired() {
  const now = new Date().toISOString();
  db.prepare(`UPDATE trades    SET status='expired' WHERE status='pending' AND expires_at < ?`).run(now);
  db.prepare(`UPDATE auctions  SET status='expired' WHERE status='active'  AND ends_at < ?`).run(now);
  db.prepare(`UPDATE bounties  SET status='expired' WHERE status='active'  AND expires_at < ?`).run(now);
  db.prepare(`UPDATE giveaways SET status='ended'   WHERE status='active'  AND ends_at < ?`).run(now);
  db.prepare(`DELETE FROM pvp_queue WHERE queued_at < datetime('now', '-2 minutes')`).run();
  db.prepare(`DELETE FROM active_battles WHERE created_at < datetime('now', '-3 hours')`).run();
  db.prepare(`UPDATE players SET is_banned=0, ban_reason=NULL, ban_expires=NULL WHERE is_banned=1 AND ban_expires IS NOT NULL AND ban_expires < ?`).run(now);
}

module.exports = {
  db, initDatabase,
  getPlayer, createPlayer, updatePlayer, addOdds, addGems,
  getPets, hasPet, addPet, removePet,
  getInv, hasItem, addItem, removeItem,
  getMats, hasMat, addMat, removeMat,
  saveBattle, getBattle, clearBattle,
  getLeaderboard, logAdmin, cleanExpired,
};
