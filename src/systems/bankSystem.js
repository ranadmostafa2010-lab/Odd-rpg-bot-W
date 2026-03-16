'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const { cleanInt } = require('../core/security');

// ── Show bank menu ────────────────────────────────────────────
async function showMenu(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const tiers = R().game.bank.tiers;
  const currentTier = tiers.find(t => t.tier === player.bank_tier) || tiers[0];
  const nextTier = tiers.find(t => t.tier === player.bank_tier + 1);
  
  let msg = 
    `🏦 *Bank Account*\n\n` +
    `${currentTier.emoji} **${currentTier.name}** (Tier ${currentTier.tier})\n` +
    `Balance: **${E.fmt(player.bank_balance)} 🪙**\n` +
    `Interest: **${currentTier.interest_pct}%** daily\n` +
    `Capacity: **${E.fmt(currentTier.max)} 🪙**\n\n`;
    
  if (nextTier) {
    msg += `⬆️ Next tier: **${nextTier.name}**\n`;
    msg += `Cost: ${E.fmt(nextTier.cost)} 🪙 | Interest: ${nextTier.interest_pct}% | Max: ${E.fmt(nextTier.max)}\n`;
    msg += `/bank upgrade — Upgrade account\n\n`;
  } else {
    msg += `👑 **Maximum tier reached!**\n\n`;
  }
  
  msg += `/bank deposit [amount] — Store Odds\n`;
  msg += `/bank withdraw [amount] — Take Odds`;
  
  await E.msg(sock, jid, msg);
}

// ── Deposit ───────────────────────────────────────────────────
async function deposit(sock, jid, playerId, amountStr) {
  const player = DB.getPlayer(playerId);
  const tier = R().game.bank.tiers.find(t => t.tier === player.bank_tier);
  
  const amount = cleanInt(amountStr, 1, Math.min(player.odds, tier.max - player.bank_balance));
  if (!amount) return E.msg(sock, jid, `❌ Invalid amount. You have ${E.fmt(player.odds)} 🪙, max capacity ${E.fmt(tier.max)}.`);
  
  E.takeOdds(playerId, amount);
  DB.updatePlayer(playerId, { bank_balance: player.bank_balance + amount });
  
  await E.msg(sock, jid, `✅ Deposited **${E.fmt(amount)} 🪙** into bank.\nNew balance: **${E.fmt(player.bank_balance + amount)} 🪙**`);
}

// ── Withdraw ────────────────────────────────────────────────────
async function withdraw(sock, jid, playerId, amountStr) {
  const player = DB.getPlayer(playerId);
  
  const amount = cleanInt(amountStr, 1, player.bank_balance);
  if (!amount) return E.msg(sock, jid, `❌ Invalid amount. Bank balance: ${E.fmt(player.bank_balance)} 🪙.`);
  
  E.giveOdds(playerId, amount);
  DB.updatePlayer(playerId, { bank_balance: player.bank_balance - amount });
  
  await E.msg(sock, jid, `✅ Withdrew **${E.fmt(amount)} 🪙** from bank.\nNew balance: **${E.fmt(player.bank_balance - amount)} 🪙**`);
}

// ── Upgrade tier ────────────────────────────────────────────────
async function upgrade(sock, jid, playerId) {
  const player = DB.getPlayer(playerId);
  const tiers = R().game.bank.tiers;
  const nextTier = tiers.find(t => t.tier === player.bank_tier + 1);
  
  if (!nextTier) return E.msg(sock, jid, '❌ Already at maximum tier!');
  if (player.odds < nextTier.cost) return E.msg(sock, jid, `❌ Need **${E.fmt(nextTier.cost)} 🪙** to upgrade. Have **${E.fmt(player.odds)}**.`);
  
  E.takeOdds(playerId, nextTier.cost);
  DB.updatePlayer(playerId, { bank_tier: nextTier.tier });
  
  await E.msg(sock, jid, 
    `⬆️ **Bank Upgraded!**\n\n` +
    `${nextTier.emoji} **${nextTier.name}** (Tier ${nextTier.tier})\n` +
    `Interest: **${nextTier.interest_pct}%** daily\n` +
    `Capacity: **${E.fmt(nextTier.max)} 🪙**`
  );
}

// ── Daily interest (called by scheduler) ──────────────────────
function applyInterest() {
  const tiers = R().game.bank.tiers;
  const players = DB.db.prepare('SELECT id, bank_balance, bank_tier FROM players WHERE bank_balance > 0').all();
  
  let totalPaid = 0;
  for (const p of players) {
    const tier = tiers.find(t => t.tier === p.bank_tier) || tiers[0];
    const interest = Math.floor(p.bank_balance * tier.interest_pct / 100);
    if (interest > 0) {
      const newBalance = Math.min(p.bank_balance + interest, tier.max);
      const actualInterest = newBalance - p.bank_balance;
      if (actualInterest > 0) {
        DB.updatePlayer(p.id, { bank_balance: newBalance });
        totalPaid += actualInterest;
      }
    }
  }
  
  console.log(`[bank] Daily interest applied: ${E.fmt(totalPaid)} 🪙 to ${players.length} accounts`);
}

module.exports = { showMenu, deposit, withdraw, upgrade, applyInterest };
