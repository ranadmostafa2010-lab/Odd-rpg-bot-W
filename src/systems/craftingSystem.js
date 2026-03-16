'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const RECIPES = {
  health_potion: { name: 'Health Potion', emoji: '🧪', mats: { monster_core: 2, herb: 1 }, qty: 1 },
  full_restore: { name: 'Full Restore', emoji: '❤️‍🩹', mats: { monster_core: 5, magic_essence: 2 }, qty: 1 },
  rare_crate: { name: 'Rare Crate', emoji: '🎁', mats: { monster_core: 10, magic_essence: 5, ancient_bark: 1 }, qty: 1 },
  steel_sword: { name: 'Steel Sword', emoji: '🗡️', mats: { iron_ore: 15, monster_core: 5 }, qty: 1 },
  chainmail: { name: 'Chainmail', emoji: '⛓️', mats: { iron_ore: 20, leather: 10 }, qty: 1 },
  xp_boost: { name: 'XP Boost Scroll', emoji: '📜⭐', mats: { magic_essence: 3, monster_core: 3 }, qty: 1 }
};

// ── Show materials ─────────────────────────────────────────────────
async function showMaterials(sock, jid, playerId) {
  const mats = DB.getMats(playerId);
  if (!mats.length) return E.msg(sock, jid, '🧪 No materials. Get them from PvE battles!');
  
  let msg = `🧪 *Materials*\n\n`;
  for (const m of mats) {
    msg += `• **${m.material_id}**: ${m.quantity}\n`;
  }
  msg += `\n/recipes — See what you can craft`;
  await E.msg(sock, jid, msg);
}

// ── Show recipes ───────────────────────────────────────────────────
async function showRecipes(sock, jid, playerId) {
  const mats = DB.getMats(playerId);
  const matMap = {};
  mats.forEach(m => matMap[m.material_id] = m.quantity);
  
  let msg = `🔨 *Crafting Recipes*\n\n`;
  
  for (const [id, r] of Object.entries(RECIPES)) {
    const canCraft = Object.entries(r.mats).every(([mat, need]) => (matMap[mat] || 0) >= need);
    const status = canCraft ? '✅' : '❌';
    
    msg += `${status} **${r.emoji} ${r.name}** — /craft ${id}\n`;
    msg += `Needs: ${Object.entries(r.mats).map(([m,q]) => `${q} ${m}`).join(', ')}\n\n`;
  }
  
  await E.msg(sock, jid, msg);
}

// ── Craft item ───────────────────────────────────────────────────────
async function craft(sock, jid, playerId, recipeId) {
  const recipe = RECIPES[recipeId];
  if (!recipe) return E.msg(sock, jid, '❌ Recipe not found. /recipes to see options.');
  
  // Check materials
  for (const [mat, need] of Object.entries(recipe.mats)) {
    if (!DB.hasMat(playerId, mat, need)) {
      return E.msg(sock, jid, `❌ Need ${need} ${mat}. /materials to check.`);
    }
  }
  
  // Consume materials
  for (const [mat, need] of Object.entries(recipe.mats)) {
    DB.removeMat(playerId, mat, need);
  }
  
  // Give product
  if (recipeId.includes('crate')) {
    DB.addItem(playerId, recipeId, recipe.qty);
  } else if (['health_potion','full_restore','xp_boost'].includes(recipeId)) {
    DB.addItem(playerId, recipeId, recipe.qty);
  } else {
    // Gear - add to inventory as item
    DB.addItem(playerId, recipeId, recipe.qty);
  }
  
  await E.msg(sock, jid, `✅ Crafted **${recipe.emoji} ${recipe.name}** x${recipe.qty}!`);
}

module.exports = { showMaterials, showRecipes, craft };
