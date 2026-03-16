'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

// ── Show prestige info ──────────────────────────────────────────
async function show(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const cfg = R().game.prestige;
  
  let msg = `🔄 *Prestige System*\n\n`;
  
  if (player.prestige >= cfg.tiers.length) {
    msg += `👑 **MAX PRESTIGE REACHED!**\n\n`;
    msg += `You are a true legend of ODD RPG!`;
    return E.msg(sock, jid, msg);
  }
  
  const nextTier = cfg.tiers[player.prestige]; // 0-indexed, so this is correct
  
  msg += `Current: **${player.prestige > 0 ? cfg.tiers[player.prestige - 1].badge : 'None'} Prestige ${player.prestige}**\n\n`;
  
  if (player.level < cfg.required_level) {
    msg += `❌ Requirement: **Level ${cfg.required_level}**\n`;
    msg += `You are Level ${player.level} — keep grinding!\n`;
    msg += `Come back at Level ${cfg.required_level} to prestige.`;
    return E.msg(sock, jid, msg);
  }
  
  msg += `✅ Ready to prestige!\n\n`;
  msg += `Next Tier: **${nextTier.badge} ${nextTier.title}**\n`;
  msg += `Benefits:\n`;
  msg += `• Odds multiplier: **${nextTier.odds_x}x**\n`;
  msg += `• XP multiplier: **${nextTier.xp_x}x**\n`;
  msg += `• Bonus: **${nextTier.gems} 💎**\n\n`;
  
  msg += `⚠️ **WARNING:** Prestige will:\n`;
  msg += `• Reset you to Level 1\n`;
  msg += `• Keep your pets and gems\n`;
  msg += `• Keep prestige badge forever\n`;
  msg += `• Apply permanent bonuses\n\n`;
  
  msg += `/prestige confirm — **IRREVERSIBLE**`;
  
  await E.msg(sock, jid, msg);
}

// ── Do prestige ─────────────────────────────────────────────────
async function doPrestige(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const cfg = R().game.prestige;
  
  if (player.level < cfg.required_level) {
    return E.msg(sock, jid, `❌ Need Level ${cfg.required_level} to prestige!`);
  }
  
  if (player.prestige >= cfg.tiers.length) {
    return E.msg(sock, jid, '❌ Already at maximum prestige!');
  }
  
  const newPrestige = player.prestige + 1;
  const tier = cfg.tiers[player.prestige]; // Current tier (0-indexed)
  
  // Give gems bonus
  E.giveGems(playerId, tier.gems);
  
  // Reset level but keep prestige
  const newPlayer = {
    level: 1,
    xp: 0,
    hp: 100,
    max_hp: 100,
    attack: 15,
    defense: 10,
    prestige: newPrestige,
    prestige_badge: tier.badge,
    skill_points: 0, // Reset skill points but they can respec
    story_world: 'forest',
    story_chapter: 1,
    // Keep: pets, gems, bank, inventory, materials, achievements, titles
  };
  
  DB.updatePlayer(playerId, newPlayer);
  
  // Clear skills (they get refunded points via skill_points reset)
  DB.db.prepare('DELETE FROM player_skills WHERE player_id=?').run(playerId);
  
  // Re-apply class if they had one
  if (player.class) {
    const cls = R.class(player   .class);
    DB.updatePlayer(playerId, {
      max_hp: Math.floor(100 * cls.hp_mult),
      hp: Math.floor(100 * cls.hp_mult),
      attack: Math.floor(15 * cls.atk_mult),
      defense: Math.floor(10 * cls.def_mult)
    });
  }
  
  await E.msg(sock, jid,
    `🔄 **PRESTIGE COMPLETE!**\n\n` +
    `${tier.badge} **${tier.title}** achieved!\n\n` +
    msg += `❌ Requirement: **Level ${cfg.required_level}**\n`;
    msg += `You are Level ${player.level} — keep grinding!\n`;
    msg += `Come back at Level ${cfg.required_level} to prestige.`;
    return E.msg(sock, jid, msg);
  }
  
  msg += `✅ Ready to prestige!\n\n`;
  msg += `Next Tier: **${nextTier.badge} ${nextTier.title}**\n`;
  msg += `Benefits:\n`;
  msg += `• Odds multiplier: **${nextTier.odds_x}x**\n`;
  msg += `• XP multiplier: **${nextTier.xp_x}x**\n`;
  msg += `• Bonus: **${nextTier.gems} 💎**\n\n`;
  
  msg += `⚠️ **WARNING:** Prestige will:\n`;
  msg += `• Reset you to Level 1\n`;
  msg += `• Keep your pets and gems\n`;
  msg += `• Keep prestige badge forever\n`;
  msg += `• Apply permanent bonuses\n\n`;
  
  msg += `/prestige confirm — **IRREVERSIBLE**`;
  
  await E.msg(sock, jid, msg);
}

// ── Do prestige ─────────────────────────────────────────────────
async function doPrestige(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const cfg = R().game.prestige;
  
  if (player.level < cfg.required_level) {
    return E.msg(sock, jid, `❌ Need Level ${cfg.required_level} to prestige!`);
  }
  
  if (player.prestige >= cfg.tiers.length) {
    return E.msg(sock, jid, '❌ Already at maximum prestige!');
  }
  
  const newPrestige = player.prestige + 1;
  const tier = cfg.tiers[player.prestige]; // Current tier (0-indexed)
  
  // Give gems bonus
  E.giveGems(playerId, tier.gems);
  
  // Reset level but keep prestige
  const newPlayer = {
    level: 1,
    xp: 0,
    hp: 100,
    max_hp: 100,
    attack: 15,
    defense: 10,
    prestige: newPrestige,
    prestige_badge: tier.badge,
    skill_points: 0, // Reset skill points but they can respec
    story_world: 'forest',
    story_chapter: 1,
    // Keep: pets, gems, bank, inventory, materials, achievements, titles
  };
  
  DB.updatePlayer(playerId, newPlayer);
  
  // Clear skills (they get refunded points via skill_points reset)
  DB.db.prepare('DELETE FROM player_skills WHERE player_id=?').run(playerId);
  
  // Re-apply class if they had one
  if (player.class) {
    const cls = R.class(player.class);
    DB.updatePlayer(playerId, {
      max_hp: Math.floor(100 * cls.hp_mult),
      hp: Math.floor(100 * cls.hp_mult),
      attack: Math.floor(15 * cls.atk_mult),
      defense: Math.floor(10 * cls.def_mult)
    });
  }
  
  await E.msg(sock, jid,
    `🔄 **PRESTIGE COMPLETE!**\n\n` +
    `${tier.badge} **${tier.title}** achieved!\n\n` +
    `🎁 Bonus: **${tier.gems} 💎**\n` +
    `Permanent bonuses active:\n` +
    `• ${tier.odds_x}x Odds from all sources\n` +
    `• ${tier.xp_x}x XP from all sources\n\n` +
    `Reset to Level 1 with your gear intact.\n` +
    `Climb to Level ${cfg.required_level} again for next prestige!`
  );
}

module.exports = { show, doPrestige };
