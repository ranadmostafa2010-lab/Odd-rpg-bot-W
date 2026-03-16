'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

// ── Show available classes ──────────────────────────────────────
async function showClasses(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  if (player.class) {
    const current = R.class(player.class);
    return E.msg(sock, jid, 
      `⚔️ *Your Class: ${current?.emoji} ${current?.name}*\n\n` +
      `_${current?.desc}_\n\n` +
      `**Passive:** ${current?.passive_name}\n` +
      `${current?.passive_desc}\n\n` +
      `**Skill:** /${current?.cmd} — ${current?.skill_name}\n` +
      `${current?.skill_desc}\n\n` +
      `Classes are permanent. Choose wisely!`
    );
  }
  
  const classes = R().game.classes;
  let msg = `⚔️ *Choose Your Class*\n\nClasses are **permanent**! Choose wisely:\n\n`;
  
  for (const [id, c] of Object.entries(classes)) {
    msg += `${c.emoji} **${c.name}** — /class ${id}\n`;
    msg += `_${c.desc}_\n`;
    msg += `HP: ${c.hp_mult}x | ATK: ${c.atk_mult}x | DEF: ${c.def_mult}x\n\n`;
  }
  
  msg += `Use /class [name] to select. Example: /class warrior`;
  await E.msg(sock, jid, msg);
}

// ── Pick class ─────────────────────────────────────────────────
async function pickClass(sock, jid, playerId, classId) {
  const player = DB.getPlayer(playerId);
  if (player.class) return E.msg(sock, jid, `❌ You are already a **${R.class(player.class)?.name}**! Classes are permanent.`);
  
  const cls = R.class(classId);
  if (!cls) return E.msg(sock, jid, `❌ Class "${classId}" not found. /class to see options.`);
  
  // Apply stat multipliers
  const newStats = {
    class: classId,
    max_hp: Math.floor(player.max_hp * cls.hp_mult),
    hp: Math.floor(player.max_hp * cls.hp_mult),
    attack: Math.floor(player.attack * cls.atk_mult),
    defense: Math.floor(player.defense * cls.def_mult)
  };
  
  DB.updatePlayer(playerId, newStats);
  
  await E.msg(sock, jid,
    `⚔️ **Class Selected: ${cls.emoji} ${cls.name}**\n\n` +
    `New stats applied!\n` +
    `❤️ HP: ${newStats.max_hp} | ⚔️ ATK: ${newStats.attack} | 🛡️ DEF: ${newStats.defense}\n\n` +
    `**Passive:** ${cls.passive_name}\n` +
    `${cls.passive_desc}\n\n` +
    `**Skill:** /${cls.cmd} — ${cls.skill_name}\n` +
    `${cls.skill_desc}\n\n` +
    `Good luck, ${cls.name}!`
  );
}

module.exports = { showClasses, pickClass };
