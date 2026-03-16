// ════════════════════════════════════════════════════════════════
//  registry.js  —  CENTRAL GAME REGISTRY
//  ★ This is where you add new content ★
//
//  TO ADD A NEW PET:     Add entry to src/config/pets.json
//  TO ADD A NEW ENEMY:   Add entry to src/config/enemies.json
//  TO ADD A NEW CRATE:   Add entry to src/config/crates.json
//  TO ADD A NEW ITEM:    Add entry to src/config/shop_items.json
//  TO ADD A NEW WORLD:   Add entry to src/config/worlds.json
//  TO ADD A NEW COMMAND: Add case to src/handlers/messageHandler.js
//  TO ADD A NEW SYSTEM:  Create src/systems/yourSystem.js
//                        Add require() at bottom of this file
//
//  Everything reads from this registry — no other file needs changes.
// ════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load all JSON configs ────────────────────────────────────────
function loadConfig(filename) {
  const filePath = path.join(__dirname, 'config', filename);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`[registry] Failed to load ${filename}:`, e.message);
    return {};
  }
}

// Re-loadable (hot-reload support — changes to JSON apply without restart)
function R() {
  return {
    game:      loadConfig('game_config.json'),
    admin:     loadConfig('admin_config.json'),
    pets:      loadConfig('pets.json').pets      || [],
    enemies:   loadConfig('enemies.json').enemies || [],
    bosses:    loadConfig('enemies.json').random_bosses || [],
    worlds:    loadConfig('worlds.json').worlds   || [],
    items:     loadConfig('shop_items.json').items || [],
    crates:    loadConfig('crates.json').crates   || [],
    classes:   loadConfig('classes_config.json').classes || {},
    dungeons:  loadConfig('dungeons_config.json').dungeons || [],
  };
}

// ── Lookup helpers (used by all systems) ────────────────────────

/** Get pet by ID */
R.pet = (id) => R().pets.find(p => p.id === id) || null;

/** Get enemy by ID */
R.enemy = (id) => {
  const r = R();
  return r.enemies.find(e => e.id === id) || r.bosses.find(b => b.id === id) || null;
};

/** Get item by ID */
R.item = (id) => R().items.find(i => i.id === id) || null;

/** Get crate by ID */
R.crate = (id) => R().crates.find(c => c.id === id) || null;

/** Get world by ID */
R.world = (id) => R().worlds.find(w => w.id === id) || null;

/** Get dungeon by ID */
R.dungeon = (id) => R().dungeons.find(d => d.id === id) || null;

/** Get class config by ID */
R.class = (id) => R().classes[id] || null;

/** Get all enemies available for a world at a given level */
R.enemyPool = (worldId, playerLevel) => {
  const world = R.world(worldId);
  if (!world) return R().enemies.filter(e => e.min_level <= playerLevel);
  return R().enemies.filter(e => world.enemy_pool.includes(e.id) && e.min_level <= playerLevel);
};

/** Get game config value safely */
R.cfg = (path) => {
  const parts  = path.split('.');
  let   cursor = R().game;
  for (const p of parts) {
    if (cursor === undefined || cursor === null) return undefined;
    cursor = cursor[p];
  }
  return cursor;
};

// ── Config write helper (for admin commands that save to JSON) ───
R.saveConfig = (filename, data) => {
  const filePath = path.join(__dirname, 'config', filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

/** Add a new pet to pets.json dynamically */
R.addPetToConfig = (petObj) => {
  const cfg = loadConfig('pets.json');
  if (!cfg.pets) cfg.pets = [];
  cfg.pets.push(petObj);
  R.saveConfig('pets.json', cfg);
};

/** Add a new crate to crates.json dynamically */
R.addCrateToConfig = (crateObj) => {
  const cfg = loadConfig('crates.json');
  if (!cfg.crates) cfg.crates = [];
  cfg.crates.push(crateObj);
  R.saveConfig('crates.json', cfg);
};

/** Add a new enemy to enemies.json dynamically */
R.addEnemyToConfig = (enemyObj) => {
  const cfg = loadConfig('enemies.json');
  if (!cfg.enemies) cfg.enemies = [];
  cfg.enemies.push(enemyObj);
  R.saveConfig('enemies.json', cfg);
};

module.exports = R;