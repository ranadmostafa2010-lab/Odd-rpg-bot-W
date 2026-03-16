// ════════════════════════════════════════════════════════════════
//  messageHandler.js  —  Routes all commands
//  Security first: flood → rate limit → maintenance → route
//
//  TO ADD A NEW COMMAND:
//    1. Add a case in the switch below
//    2. Require the system at the top
//    3. Done. Nothing else changes.
// ════════════════════════════════════════════════════════════════
'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const SEC = require('../core/security');
const BM  = require('../core/battleManager');

// ── Systems ───────────────────────────────────────────────────
const PVE   = require('../systems/pveSystem');
const PVP   = require('../systems/pvpSystem');
const BANK  = require('../systems/bankSystem');
const TRADE = require('../systems/tradingSystem');
const STEAL = require('../systems/stealingSystem');
const ADMIN = require('../systems/adminSystem');
const CLASS = require('../systems/classSystem');
const SKILL = require('../systems/skillTreeSystem');
const GUILD = require('../systems/guildSystem');
const QUEST = require('../systems/questSystem');
const ACH   = require('../systems/achievementSystem');
const DUN   = require('../systems/dungeonSystem');
const TOUR  = require('../systems/tournamentSystem');
const PRES  = require('../systems/prestigeSystem');
const BREED = require('../systems/breedingSystem');
const CAS   = require('../systems/casinoSystem');
const RAID  = require('../systems/raidSystem');
const AUC   = require('../systems/auctionSystem');
const CRAFT = require('../systems/craftingSystem');
const WEA   = require('../systems/weatherSystem');
const TITLE = require('../systems/titlesSystem');
const BOUNTY= require('../systems/bountySystem');
const GEM   = require('../systems/gemStoreSystem');
const EVENT = require('../systems/worldEventSystem');

// ── Main handler ──────────────────────────────────────────────
async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  const sid = (msg.key.participant || jid).replace(/@.+/,'');
  if (!sid || sid.length < 7) return;

  const body = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
  const prefix = R().game.bot.prefix;
  if (!body.startsWith(prefix)) return;

  // Security
  if (SEC.isFlooding(sid)) return;
  if (!SEC.checkRate(sid, 'default').ok) return;

  const parts = body.slice(prefix.length).trim().split(/\s+/);
  const cmd   = parts[0]?.toLowerCase();
  const args  = parts.slice(1);
  if (!cmd) return;

  // Maintenance (admins bypass)
  if (R().game.bot.maintenance_mode && !ADMIN.isAdmin(sid)) {
    return E.msg(sock, jid, R().game.bot.maintenance_message);
  }

  // Update last activity
  try { DB.db.prepare("UPDATE players SET last_command=datetime('now') WHERE id=?").run(sid); } catch (_) {}

  try {
    await route(sock, jid, sid, cmd, args);
  } catch (err) {
    console.error(`[handler] /${cmd}:`, err.message);
    await E.msg(sock, jid, '⚠️ Something went wrong. Please try again!');
  }
}

// ── Route ─────────────────────────────────────────────────────
async function route(sock, jid, id, cmd, args) {

  // ── Account creation (no account required) ───────────────────
  if (cmd === 'start' || cmd === 'register') {
    let player = DB.getPlayer(id);
    if (player) {
      await PVE.collectOfflineGrind(sock, jid, id);
      DB.db.prepare("UPDATE players SET last_login=datetime('now'), offline_since=NULL WHERE id=?").run(id);
      return showProfile(sock, jid, player);
    }
    const cfg  = R().game.new_player;
    const name = SEC.cleanName(args.join(' '), 20) || `Player${id.slice(-4)}`;
    player     = DB.createPlayer(id, name, cfg);
    DB.addPet(id, cfg.starter_pet);
    DB.updatePlayer(id, { equipped_pet: cfg.starter_pet, last_login: new Date().toISOString() });
    DB.addItem(id, 'starter_crate');
    return E.msg(sock, jid,
      `🎮 *Welcome to ODD RPG V1.0 Re-Imagined!*\n\n` +
      `Character **${name}** created!\n\n` +
      `🪙 ${cfg.starting_odds} Odds  💎 ${cfg.starting_gems} Gems\n` +
      `🐾 Starter pet equipped!\n📦 Starter crate in /inventory\n\n` +
      `/class — Pick your class (FREE!)\n` +
      `/tutorial — Learn the game\n` +
      `/menu — All commands`
    );
  }

  // All commands below require an account
  const player = DB.getPlayer(id);
  if (!player) return E.msg(sock, jid, '👋 Type /start to create your account!');
  if (player.is_banned) return E.msg(sock, jid, `🚫 You are banned.\nReason: ${player.ban_reason || 'None'}`);

  switch (cmd) {

    // ══ INFO ════════════════════════════════════════════════════
    case 'menu': case 'help':   return showMenu(sock, jid);
    case 'tutorial':            return showTutorial(sock, jid);
    case 'stats': case 'profile': case 'me': return showProfile(sock, jid, player);
    case 'online':              return showOnline(sock, jid);
    case 'daily':               return claimDaily(sock, jid, id, player);
    case 'leaderboard': case 'lb': case 'top': return showLeaderboard(sock, jid, args[0] || 'elo');
    case 'rank':                return showRank(sock, jid, player);
    case 'inventory': case 'inv': case 'bag': return showInventory(sock, jid, id);
    case 'event':               return EVENT.showEvent(sock, jid);
    case 'weather':             return WEA.showWeather(sock, jid);

    // ══ COMBAT ══════════════════════════════════════════════════
    case 'battle': case 'fight': case 'pve':
      return PVE.startBattle(sock, jid, id, args[0] || 'normal');
    case 'attack':    return BM.doAction(sock, jid, id, 'attack');
    case 'heavy':     return BM.doAction(sock, jid, id, 'heavy_attack');
    case 'defend':    return BM.doAction(sock, jid, id, 'defend');
    case 'heal':      return BM.doAction(sock, jid, id, 'heal');
    case 'special':   return BM.doAction(sock, jid, id, 'special');
    case 'flee':      return BM.doAction(sock, jid, id, 'flee');
    // Class skills — add new ones here as needed
    case 'bash':      return BM.doAction(sock, jid, id, 'bash');
    case 'meteor':    return BM.doAction(sock, jid, id, 'meteor');
    case 'backstab':  return BM.doAction(sock, jid, id, 'backstab');
    case 'nova':      return BM.doAction(sock, jid, id, 'nova');
    case 'rampage':   return BM.doAction(sock, jid, id, 'rampage');

    // ══ STORY ══════════════════════════════════════════════════
    case 'story':
      if (args[0] === 'next') return PVE.advanceStory(sock, jid, id);
      return PVE.showStory(sock, jid, id);

    // ══ PVP ════════════════════════════════════════════════════
    case 'ranked': case 'pvp': return PVP.joinQueue(sock, jid, id);
    case 'pvpcancel':          return PVP.leaveQueue(sock, jid, id);
    case 'pvpattack':          return PVP.doAction(sock, jid, id, 'pvpattack');
    case 'pvpheavy':           return PVP.doAction(sock, jid, id, 'pvpheavy');
    case 'pvpdefend':          return PVP.doAction(sock, jid, id, 'pvpdefend');
    case 'pvpheal':            return PVP.doAction(sock, jid, id, 'pvpheal');
    case 'pvpspecial':         return PVP.doAction(sock, jid, id, 'pvpspecial');
    case 'pvpsurrender':       return PVP.doAction(sock, jid, id, 'pvpsurrender');
    case 'spectate':           return PVP.spectate(sock, jid, id, args[0]);

    // ══ CLASS ══════════════════════════════════════════════════
    case 'class':
      if (!args[0]) return CLASS.showClasses(sock, jid, id);
      return CLASS.pickClass(sock, jid, id, args[0]);

    // ══ SKILLS ═════════════════════════════════════════════════
    case 'skills': case 'tree': return SKILL.showSkills(sock, jid, id);
    case 'skillup':   return SKILL.levelUp(sock, jid, id, SEC.cleanId(args[0]));
    case 'skillreset':return SKILL.resetSkills(sock, jid, id);

    // ══ BANK ═══════════════════════════════════════════════════
    case 'bank':
      if (!args[0])             return BANK.showMenu(sock, jid, id);
      if (args[0]==='deposit')  return BANK.deposit(sock, jid, id, args[1]);
      if (args[0]==='withdraw') return BANK.withdraw(sock, jid, id, args[1]);
      if (args[0]==='upgrade')  return BANK.upgrade(sock, jid, id);
      return BANK.showMenu(sock, jid, id);

    // ══ SHOP ═══════════════════════════════════════════════════
    case 'shop':  return showShop(sock, jid);
    case 'buy':   return buyItem(sock, jid, id, player, SEC.cleanId(args[0]), args[1]);

    // ══ CRATES ═════════════════════════════════════════════════
    case 'crates': case 'crate':
      if (!args[0]) return showCrates(sock, jid, id);
      return openCrate(sock, jid, id, player, SEC.cleanId(args[0]));

    // ══ TRADING ════════════════════════════════════════════════
    case 'trade':   return TRADE.send(sock, jid, id, args[0], args[1], args[2]);
    case 'accept':  return TRADE.accept(sock, jid, id);
    case 'decline': return TRADE.decline(sock, jid, id);
    case 'trades':  return TRADE.list(sock, jid, id);

    // ══ STEALING ═══════════════════════════════════════════════
    case 'targets': return STEAL.listTargets(sock, jid, id);
    case 'steal':
      if (!args[0]) return STEAL.listTargets(sock, jid, id);
      return STEAL.steal(sock, jid, id, args[0]);

    // ══ PETS ═══════════════════════════════════════════════════
    case 'pets':      return showPets(sock, jid, id, player);
    case 'equip':     return equipPet(sock, jid, id, args[0]);
    case 'unequip':   return unequipPet(sock, jid, id);
    case 'breed':     return BREED.breed(sock, jid, id, args[0], args[1]);
    case 'breedinfo': return BREED.info(sock, jid);

    // ══ CRAFTING ═══════════════════════════════════════════════
    case 'materials': case 'mats': return CRAFT.showMaterials(sock, jid, id);
    case 'recipes':               return CRAFT.showRecipes(sock, jid, id);
    case 'craft':                 return CRAFT.craft(sock, jid, id, SEC.cleanId(args[0]));

    // ══ GUILD ══════════════════════════════════════════════════
    case 'guild': return handleGuild(sock, jid, id, args);

    // ══ QUESTS ═════════════════════════════════════════════════
    case 'quest': case 'quests':
      if (args[0]==='claim') return QUEST.claim(sock, jid, id);
      return QUEST.show(sock, jid, id);

    // ══ ACHIEVEMENTS ═══════════════════════════════════════════
    case 'achievements': case 'ach': return ACH.show(sock, jid, id);

    // ══ TITLES ═════════════════════════════════════════════════
    case 'titles':  return TITLE.show(sock, jid, id);
    case 'title':   return TITLE.equip(sock, jid, id, SEC.cleanId(args[0]));

    // ══ PRESTIGE ═══════════════════════════════════════════════
    case 'prestige':
      if (args[0]==='confirm') return PRES.doPrestige(sock, jid, id);
      return PRES.show(sock, jid, id);

    // ══ BOUNTIES ═══════════════════════════════════════════════
    case 'bounty':   return BOUNTY.post(sock, jid, id, args[0], args[1]);
    case 'bounties': return BOUNTY.board(sock, jid, id);
    case 'mybounty': return BOUNTY.mine(sock, jid, id);

    // ══ CASINO ═════════════════════════════════════════════════
    case 'coinflip': case 'cf':
      return SEC.checkRate(id,'casino').ok ? CAS.coinflip(sock,jid,id,args[0],args[1]) : E.msg(sock,jid,'⏳ Slow down!');
    case 'dice':
      return SEC.checkRate(id,'casino').ok ? CAS.dice(sock,jid,id,args[0]) : E.msg(sock,jid,'⏳ Slow down!');
    case 'blackjack': case 'bj': return CAS.bjStart(sock, jid, id, args[0]);
    case 'bjhit':    return CAS.bjHit(sock, jid, id);
    case 'bjstand':  return CAS.bjStand(sock, jid, id);
    case 'slots':
      return SEC.checkRate(id,'casino').ok ? CAS.slots(sock,jid,id,args[0]) : E.msg(sock,jid,'⏳ Slow down!');

    // ══ DUNGEONS ═══════════════════════════════════════════════
    case 'dungeon': return handleDungeon(sock, jid, id, args);
    case 'dattack': return DUN.dungeonAction(sock, jid, id, 'dattack');
    case 'dheavy':  return DUN.dungeonAction(sock, jid, id, 'dheavy');
    case 'dheal':   return DUN.dungeonAction(sock, jid, id, 'dheal');
    case 'dflee':   return DUN.dungeonAction(sock, jid, id, 'dflee');

    // ══ TOURNAMENT ═════════════════════════════════════════════
    case 'tournament':
      if (args[0]==='signup') return TOUR.signupTournament(sock, jid, id);
      return TOUR.showTournament(sock, jid, id);

    // ══ RAIDS ══════════════════════════════════════════════════
    case 'raid':        return RAID.showRaid(sock, jid, id);
    case 'raidattack':  return RAID.raidAttack(sock, jid, id, 'attack');
    case 'raidheavy':   return RAID.raidAttack(sock, jid, id, 'raidheavy');

    // ══ AUCTION ════════════════════════════════════════════════
    case 'auction': return handleAuction(sock, jid, id, player, args);

    // ══ GEM STORE ══════════════════════════════════════════════
    case 'gemstore': case 'gems': return GEM.showStore(sock, jid, id);
    case 'redeem':  return GEM.redeem(sock, jid, id, args[0]);

    // ══ GIVEAWAY ════════════════════════════════════════════════
    case 'enter': return enterGiveaway(sock, jid, id);

    // ══ ADMIN ══════════════════════════════════════════════════
    case 'admin': return ADMIN.handle(sock, jid, id, args);

    default: break; // Unknown command — silently ignore
  }
}

// ── Sub-routers ───────────────────────────────────────────────
async function handleGuild(sock, jid, id, args) {
  const sub = (args[0] || '').toLowerCase();
  if (!sub || sub === 'menu' || sub === 'info') return GUILD.showGuildMenu(sock, jid, id);
  if (sub === 'create')  return GUILD.createGuild(sock, jid, id, args[1], args[2]);
  if (sub === 'invite')  return GUILD.inviteToGuild(sock, jid, id, args[1]);
  if (sub === 'join')    return GUILD.joinGuild(sock, jid, id);
  if (sub === 'leave')   return GUILD.leaveGuild(sock, jid, id);
  if (sub === 'war')     return GUILD.declareWar(sock, jid, id, args.slice(1).join(' '));
  if (sub === 'decline') return GUILD.leaveGuild(sock, jid, id);
  if (sub === 'chest' && args[1] === 'withdraw') return GUILD.withdrawChest(sock, jid, id, args[2]);
  return GUILD.showGuildMenu(sock, jid, id);
}

async function handleDungeon(sock, jid, id, args) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'invite') return DUN.inviteToParty(sock, jid, id, args[1]);
  if (sub === 'join')   return DUN.joinParty(sock, jid, id, args[1]);
  if (sub === 'start')  return DUN.startDungeon(sock, jid, id);
  if (!sub) return DUN.createParty(sock, jid, id, null); // shows list
  return DUN.createParty(sock, jid, id, sub);
}

async function handleAuction(sock, jid, id, player, args) {
  const sub = (args[0] || '').toLowerCase();
  if (!sub || sub === 'browse') return AUC.browseAuctions(sock, jid);
  if (sub === 'list')  return AUC.listAuction(sock, jid, id, args[1], args[2], args[3], args[4]);
  if (sub === 'bid')   return AUC.placeBid(sock, jid, id, parseInt(args[1]), args[2]);
  return AUC.browseAuctions(sock, jid);
}

// ── UI functions ──────────────────────────────────────────────
async function showProfile(sock, jid, player) {
  const p      = typeof player === 'string' ? DB.getPlayer(player) : player;
  const rank   = E.getEloRank(p.elo);
  const xpNeed = E.xpNeeded(p.level);
  const pets   = DB.getPets(p.id).length;
  const badge  = p.prestige_badge ? ` ${p.prestige_badge}` : '';

  await E.msg(sock, jid,
    `📊 *${p.name}${badge}*\n\n` +
    `⭐ Level **${p.level}** | ${p.xp}/${xpNeed} XP\n` +
    `❤️ ${E.hpBar(p.hp, p.max_hp)}\n` +
    `⚔️ ATK: ${p.attack}  🛡️ DEF: ${p.defense}\n\n` +
    `🪙 **${E.fmt(p.odds)}** Odds  💎 **${p.gems}** Gems\n` +
    `🏦 Bank: **${E.fmt(p.bank_balance)}**\n\n` +
    `${rank.emoji} **${rank.name}** — ${p.elo} ELO\n` +
    `⚔️ PvP: ${p.pvp_wins}W / ${p.pvp_losses}L\n` +
    `💀 Bosses: ${p.bosses_killed}\n\n` +
    `🌍 ${p.story_world} Ch.${p.story_chapter}\n` +
    `🐾 Pets: ${pets} | ${p.equipped_pet ? `Equipped: ${p.equipped_pet}` : 'None equipped'}\n` +
    `${p.class ? `⚔️ Class: ${p.class}` : '⚠️ /class to pick a class (free!)'}\n` +
    (p.prestige > 0 ? `🔄 Prestige: ${p.prestige}` : '')
  );
}

async function showMenu(sock, jid) {
  await E.msg(sock, jid,
    `🎮 *ODD RPG V1.0 Re-Imagined*\n\n` +
    `⚔️ *Battle*  /battle [easy/normal/hard/insane/chaos]\n` +
    `   /ranked (PvP)  /story  /dungeon  /raid\n\n` +
    `💰 *Economy*  /bank  /shop  /crates\n` +
    `   /trade [num] [odds/pet] [value]\n` +
    `   /steal [num]  /auction\n\n` +
    `🐾 *Pets & Gear*  /pets  /equip  /breed\n` +
    `   /materials  /recipes  /craft\n\n` +
    `🏰 *Social*  /guild  /bounty  /bounties\n` +
    `   /tournament  /spectate [num]\n\n` +
    `📈 *Progress*  /quest  /achievements\n` +
    `   /titles  /skills  /prestige\n` +
    `   /leaderboard [elo/level/odds/wins]\n\n` +
    `🎲 *Casino*  /coinflip  /dice  /blackjack  /slots\n\n` +
    `💎 *Gems*  /gemstore  /redeem [code]\n\n` +
    `📋 /tutorial  /stats  /weather  /event  /daily`
  );
}

async function showTutorial(sock, jid) {
  await E.msg(sock, jid,
    `📖 *HOW TO PLAY ODD RPG*\n\n` +
    `*Step 1* — Pick your class: /class\n` +
    `   5 classes: Warrior, Mage, Rogue, Healer, Berserker\n\n` +
    `*Step 2* — Fight enemies: /battle [difficulty]\n` +
    `   In battle: /attack /heavy /defend /heal /flee\n` +
    `   Class skills: /bash /meteor /backstab /nova /rampage\n\n` +
    `*Step 3* — Follow the story: /story\n` +
    `   6 worlds, each with chapters + a world boss\n\n` +
    `*Step 4* — Earn & spend Odds 🪙\n` +
    `   Bank: /bank (earns daily interest)\n` +
    `   Shop: /shop  Crates: /crates\n\n` +
    `*Step 5* — Get stronger\n` +
    `   Level up → gain skill points → /skills to spend\n` +
    `   Craft gear: /materials /recipes /craft\n\n` +
    `*Step 6* — Play with others\n` +
    `   PvP: /ranked   Guild: /guild create\n` +
    `   Dungeon (co-op): /dungeon   Raid: /raid\n\n` +
    `*Balance*\n` +
    `   Normal = average. Hard/Insane for veterans.\n` +
    `   Gems earnable in-game. NOT pay-to-win.\n` +
    `   Check /quest daily for bonus rewards!\n\n` +
    `/menu for all commands`
  );
}

async function claimDaily(sock, jid, id, player) {
  const cfg = R().game.daily;
  const now = Date.now();
  const last = player.last_daily ? new Date(player.last_daily).getTime() : 0;

  if (now - last < cfg.cooldown_hours * 3600000) {
    const hrs = Math.ceil(((last + cfg.cooldown_hours*3600000) - now) / 3600000);
    return E.msg(sock, jid, `⏳ Daily reward in **${hrs}h**. Keep your streak!`);
  }

  const streak  = (now - last) < 48*3600000 ? (player.daily_streak || 0) + 1 : 1;
  const capS    = Math.min(streak, cfg.max_streak);
  const odds    = cfg.base_odds + (capS - 1) * cfg.streak_odds_per_day;
  let   gems    = cfg.base_gems;
  if (streak % 7 === 0) gems += cfg.streak_gems_every_7_days;

  const evBonus = getEventOddsBonus();
  E.giveOdds(id, Math.floor(odds * evBonus));
  E.giveGems(id, gems);
  DB.addItem(id, 'daily_crate');
  DB.updatePlayer(id, { daily_streak: streak, last_daily: new Date().toISOString() });

  await E.msg(sock, jid,
    `🎁 *Daily Reward!*\n\n` +
    `🪙 +${E.fmt(Math.floor(odds * evBonus))} Odds${evBonus > 1 ? ` (×${evBonus} event bonus!)` : ''}\n` +
    `💎 +${gems} Gems\n` +
    `📦 +1 Daily Crate → /crate daily_crate\n` +
    `🔥 Streak: **${streak} day(s)**\n` +
    (streak % 7 === 0 ? `\n🎉 7-day streak! +${cfg.streak_gems_every_7_days} bonus 💎!\n` : '') +
    `\nCome back tomorrow!`
  );
}

async function showPets(sock, jid, id, player) {
  const owned = DB.getPets(id);
  if (!owned.length) return E.msg(sock, jid, `🐾 No pets!\nGet them from /crates or boss drops.`);
  const rarityIcons = { common:'⬜', rare:'🟦', epic:'🟪', legendary:'🟨', mythic:'🔴', celestial:'🌟' };
  let msg = `🐾 *Your Pets (${owned.length}):*\n\n`;
  owned.forEach((row, i) => {
    const p = R.pet(row.pet_id);
    if (!p) return;
    const eq = player.equipped_pet === row.pet_id ? ' ✅' : '';
    msg += `${i+1}. ${p.emoji} **${p.name}** ${rarityIcons[p.rarity] || ''}${eq}\n`;
    msg += `   ATK+${p.bonus_attack} DEF+${p.bonus_defense} HP+${p.bonus_hp}\n\n`;
  });
  msg += `/equip [slot] to equip`;
  await E.msg(sock, jid, msg);
}

async function equipPet(sock, jid, id, slotStr) {
  const pets = DB.getPets(id);
  const slot  = parseInt(slotStr) - 1;
  if (isNaN(slot) || !pets[slot]) return E.msg(sock, jid, '❌ Invalid slot. /pets to see yours.');
  const p = R.pet(pets[slot].pet_id);
  DB.updatePlayer(id, { equipped_pet: pets[slot].pet_id });
  await E.msg(sock, jid, `✅ **${p?.emoji} ${p?.name}** equipped!`);
}

async function unequipPet(sock, jid, id) {
  DB.updatePlayer(id, { equipped_pet: null });
  await E.msg(sock, jid, '✅ Pet unequipped.');
}

async function showShop(sock, jid) {
  const items = R().items.filter(i => !i.craftable_only && (i.cost_odds > 0 || i.cost_gems > 0));
  let msg = `🛒 *Shop:*\n\n`;
  for (const i of items) {
    const price = i.cost_gems > 0 ? `${i.cost_gems} 💎` : `${E.fmt(i.cost_odds)} 🪙`;
    msg += `• **${i.emoji} ${i.id}** — ${price}\n  _${i.desc}_\n\n`;
  }
  msg += `/buy [item_id] to purchase\n/buy [item_id] gems to pay with Gems`;
  await E.msg(sock, jid, msg);
}

async function buyItem(sock, jid, id, player, itemId, currStr) {
  const item = R.item(itemId);
  if (!item) return E.msg(sock, jid, `❌ Item not found. Check /shop`);
  if (item.craftable_only) return E.msg(sock, jid, '❌ Craft this item via /recipes');

  const useGems = (currStr === 'gems' || item.cost_odds === 0) && item.cost_gems > 0;
  const cost    = useGems ? item.cost_gems : item.cost_odds;
  const bal     = useGems ? player.gems : player.odds;
  if (!cost) return E.msg(sock, jid, '❌ Not directly purchasable.');
  if (bal < cost) return E.msg(sock, jid, `❌ Need **${E.fmt(cost)} ${useGems ? '💎' : '🪙'}**. Have **${E.fmt(bal)}**.`);

  if (item.max_stack) {
    const cur = DB.getInv(id).find(x => x.item_id === itemId);
    if (cur && cur.quantity >= item.max_stack) return E.msg(sock, jid, `❌ Max ${item.max_stack} of this item.`);
  }

  if (useGems) E.takeGems(id, cost); else E.takeOdds(id, cost);
  DB.addItem(id, itemId, 1);
  await E.msg(sock, jid, `✅ Bought **${item.emoji} ${item.name}** for **${E.fmt(cost)} ${useGems ? '💎' : '🪙'}**!`);
}

async function showCrates(sock, jid, id) {
  const inv = DB.getInv(id);
  let msg = `📦 *Crates:*\n\n`;
  const visible = R().crates.filter(c => !c.boss_drop_only && !c.event_only && !c.guild_only && !c.prestige_reward);
  for (const c of visible) {
    const price = c.daily_free ? 'FREE 1/day' : c.cost_gems > 0 ? `${c.cost_gems} 💎` : `${E.fmt(c.cost_odds)} 🪙`;
    const have  = inv.find(x => x.item_id === c.id);
    msg += `${c.emoji} **${c.id}**${have ? ` (x${have.quantity})` : ''} — ${price}\n_${c.desc}_\n\n`;
  }
  msg += `/crate [id] — Open one\nInventory crates: /inventory`;
  await E.msg(sock, jid, msg);
}

async function openCrate(sock, jid, id, player, crateId) {
  const crate = R.crate(crateId);
  if (!crate) return E.msg(sock, jid, '❌ Crate not found. /crates to see all');

  // Check payment
  let paid = false;
  const inv = DB.getInv(id);
  const inInv = inv.find(x => x.item_id === crateId);

  if (inInv) {
    DB.removeItem(id, crateId);
    paid = true;
  } else if (crate.daily_free) {
    const p = DB.getPlayer(id);
    if (p.last_daily_crate && (Date.now() - new Date(p.last_daily_crate).getTime()) < 20*3600000) {
      return E.msg(sock, jid, '⏳ Daily crate already opened today!');
    }
    DB.db.prepare("UPDATE players SET last_daily_crate=datetime('now') WHERE id=?").run(id);
    paid = true;
  } else if (crate.cost_gems > 0) {
    if (player.gems < crate.cost_gems) return E.msg(sock, jid, `❌ Need **${crate.cost_gems} 💎**. Have **${player.gems}**.`);
    E.takeGems(id, crate.cost_gems);
    paid = true;
  } else if (crate.cost_odds > 0) {
    const evDiscount = getEventCrateDiscount();
    const cost = Math.floor(crate.cost_odds * (1 - evDiscount/100));
    if (player.odds < cost) return E.msg(sock, jid, `❌ Need **${E.fmt(cost)} 🪙**${evDiscount > 0 ? ` (${evDiscount}% event discount!)` : ''}. Have **${E.fmt(player.odds)}**.`);
    E.takeOdds(id, cost);
    paid = true;
  }

  if (!paid) return E.msg(sock, jid, '❌ Cannot open this crate right now.');

  await E.msg(sock, jid, crate.animation || '📦 ➡️ 🔓 ➡️ ✨');
  await new Promise(r => setTimeout(r, 800));

  const rw      = crate.rewards;
  const oddsWon = E.rng(rw.odds_min, rw.odds_max);
  E.giveOdds(id, oddsWon);

  let result = `${crate.emoji} *${crate.name} Opened!*\n\n🪙 +${E.fmt(oddsWon)} Odds\n`;

  // Pet drop
  if (E.roll(rw.pet_drop_chance)) {
    let roll = E.rand() * 100;
    let dropped = null;
    for (const entry of rw.pet_table) {
      roll -= entry.chance_percent;
      if (roll <= 0) { dropped = entry.pet_id; break; }
    }
    if (dropped) {
      DB.addPet(id, dropped);
      const p = R.pet(dropped);
      const ri = { common:'⬜', rare:'🟦', epic:'🟪', legendary:'🟨', mythic:'🔴', celestial:'🌟' }[p?.rarity] || '';
      result += `\n🐾 **PET DROP!** ${p?.emoji} **${p?.name}** ${ri} [${p?.rarity}]!`;
    }
  }

  // Guaranteed item
  if (rw.guaranteed_item) {
    DB.addItem(id, rw.guaranteed_item);
    const i = R.item(rw.guaranteed_item);
    result += `\n🎁 Bonus: **${i?.emoji || '📦'} ${i?.name || rw.guaranteed_item}**`;
  }

  await E.msg(sock, jid, result);
  await QUEST.track(id, 'crate_open', 1);
}

async function showLeaderboard(sock, jid, cat) {
  const catMap = { elo:'elo', level:'level', odds:'odds', wins:'pvp_wins', bosses:'bosses_killed', prestige:'prestige' };
  const col    = catMap[cat] || 'elo';
  const top    = DB.getLeaderboard(col, R().game.leaderboard.top_count);

  let msg = `🏆 *Leaderboard — ${cat.toUpperCase()}:*\n\n`;
  top.forEach((p, i) => {
    const medal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
    const badge = p.prestige_badge ? ` ${p.prestige_badge}` : '';
    msg += `${medal} **${p.name}${badge}** — ${E.fmt(p.value)}\n`;
  });
  msg += `\nCategories: elo | level | odds | wins | bosses | prestige`;
  await E.msg(sock, jid, msg);
}

async function showRank(sock, jid, player) {
  const rank = E.getEloRank(player.elo);
  const pos  = DB.db.prepare('SELECT COUNT(*)+1 as p FROM players WHERE elo > ? AND is_banned=0').get(player.elo).p;
  await E.msg(sock, jid,
    `📊 *Your PvP Rank:*\n\n${rank.emoji} **${rank.name}**\nELO: **${player.elo}** | Global #${pos}\n${player.pvp_wins}W / ${player.pvp_losses}L`
  );
}

async function showInventory(sock, jid, id) {
  const items  = DB.getInv(id);
  const crates = R().crates;
  if (!items.length) return E.msg(sock, jid, '🎒 Inventory empty. Buy items at /shop or open /crates!');
  let msg = `🎒 *Inventory:*\n\n`;
  for (const row of items) {
    const item  = R.item(row.item_id) || crates.find(c => c.id === row.item_id);
    const emoji = item?.emoji || '📦';
    const name  = item?.name  || row.item_id;
    msg += `${emoji} **${name}** x${row.quantity}\n`;
  }
  await E.msg(sock, jid, msg);
}

async function showOnline(sock, jid) {
  const players = DB.db.prepare("SELECT name,level,elo,class FROM players WHERE last_login > datetime('now','-5 minutes') AND is_banned=0 ORDER BY level DESC LIMIT 15").all();
  if (!players.length) return E.msg(sock, jid, '👥 Nobody online right now.');
  let msg = `🟢 *Online (${players.length}):*\n\n`;
  for (const p of players) {
    const r = E.getEloRank(p.elo);
    msg += `• **${p.name}** Lv.${p.level} ${r.emoji} ${p.class ? `[${p.class}]` : ''}\n`;
  }
  await E.msg(sock, jid, msg);
}

async function enterGiveaway(sock, jid, id) {
  const now = new Date().toISOString();
  const g   = DB.db.prepare("SELECT * FROM giveaways WHERE status='active' AND ends_at > ? ORDER BY created_at DESC LIMIT 1").get(now);
  if (!g) return E.msg(sock, jid, '❌ No active giveaway right now.');
  const entries = JSON.parse(g.entries || '[]');
  if (entries.includes(id)) return E.msg(sock, jid, '✅ Already entered!');
  entries.push(id);
  DB.db.prepare('UPDATE giveaways SET entries=? WHERE id=?').run(JSON.stringify(entries), g.id);
  const left = Math.ceil((new Date(g.ends_at) - Date.now()) / 60000);
  await E.msg(sock, jid, `🎉 Entered! (${entries.length} total)\n⏳ Ends in **${left}m**. Good luck!`);
}

// ── Event bonus helpers ───────────────────────────────────────
function getEventOddsBonus() {
  try { return require('../systems/worldEventSystem').getBonus('odds_multiplier') || 1; } catch (_) { return 1; }
}
function getEventCrateDiscount() {
  try { return require('../systems/worldEventSystem').getBonus('crate_discount_pct') || 0; } catch (_) { return 0; }
}

module.exports = { handleMessage };
