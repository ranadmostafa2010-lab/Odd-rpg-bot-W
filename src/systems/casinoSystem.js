'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const { cleanInt } = require('../core/security');

const activeBj = new Map(); // playerId -> { hand, dealer, bet, deck }

// ── Coinflip ────────────────────────────────────────────────────
async function coinflip(sock, jid, playerId, choiceRaw, amountStr) {
  const cfg = R().game.casino;
  const player = DB.getPlayer(playerId);
  
  const choice = (choiceRaw || '').toLowerCase();
  if (!['heads','tails','h','t'].includes(choice)) {
    return E.msg(sock, jid, '❌ Usage: /coinflip [heads/tails] [amount]');
  }
  
  const amount = cleanInt(amountStr, cfg.min_bet, Math.min(cfg.max_bet, player.odds));
  if (!amount) return E.msg(sock, jid, `❌ Invalid bet. Min: ${E.fmt(cfg.min_bet)}, Max: ${E.fmt(cfg.max_bet)}, You have: ${E.fmt(player.odds)}`);
  
  E.takeOdds(playerId, amount);
  
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const win = (choice === 'h' && result === 'heads') || (choice === 't' && result === 'tails') || choice === result;
  
  if (win) {
    E.giveOdds(playerId, amount * 2);
    await E.msg(sock, jid, `🪙 **${result.toUpperCase()}!** You win **${E.fmt(amount * 2)} 🪙**!`);
  } else {
    await E.msg(sock, jid, `🪙 **${result.toUpperCase()}!** You lose **${E.fmt(amount)} 🪙**.`);
  }
}

// ── Dice ─────────────────────────────────────────────────────────
async function dice(sock, jid, playerId, amountStr) {
  const cfg = R().game.casino;
  const player = DB.getPlayer(playerId);
  
  const amount = cleanInt(amountStr, cfg.min_bet, Math.min(cfg.max_bet, player.odds));
  if (!amount) return E.msg(sock, jid, `❌ Invalid bet. Min: ${E.fmt(cfg.min_bet)}, Max: ${E.fmt(cfg.max_bet)}`);
  
  E.takeOdds(playerId, amount);
  
  const roll = Math.floor(Math.random() * 100) + 1; // 1-100
  
  let multiplier = 0;
  if (roll >= 95) multiplier = 10;   // 95-100: 10x
  else if (roll >= 85) multiplier = 4;  // 85-94: 4x
  else if (roll >= 70) multiplier = 2;    // 70-84: 2x
  else if (roll >= 50) multiplier = 1;    // 50-69: 1x (break even)
  // 1-49: lose
  
  if (multiplier > 0) {
    E.giveOdds(playerId, amount * multiplier);
    await E.msg(sock, jid, `🎲 Rolled **${roll}**! You win **${E.fmt(amount * multiplier)} 🪙** (${multiplier}x)!`);
  } else {
    await E.msg(sock, jid, `🎲 Rolled **${roll}**! You lose **${E.fmt(amount)} 🪙**. (Need 50+ to win)`);
  }
}

// ── Blackjack ────────────────────────────────────────────────────
async function bjStart(sock, jid, playerId, amountStr) {
  const cfg = R().game.casino;
  const player = DB.getPlayer(playerId);
  
  if (activeBj.has(playerId)) return E.msg(sock, jid, '❌ Finish your current blackjack game! /bjhit or /bjstand');
  
  const amount = cleanInt(amountStr, cfg.min_bet, Math.min(cfg.max_bet, player.odds));
  if (!amount) return E.msg(sock, jid, `❌ Invalid bet. Min: ${E.fmt(cfg.min_bet)}, Max: ${E.fmt(cfg.max_bet)}`);
  
  E.takeOdds(playerId, amount);
  
  const deck = createDeck();
  const hand = [draw(deck), draw(deck)];
  const dealer = [draw(deck), draw(deck)];
  
  activeBj.set(playerId, { hand, dealer, bet: amount, deck });
  
  const msg = formatBj(hand, dealer, true);
  await E.msg(sock, jid, msg + `\n\n/bjhit — Draw card\n/bjstand — Keep hand`);
}

async function bjHit(sock, jid, playerId) {
  const game = activeBj.get(playerId);
  if (!game) return E.msg(sock, jid, '❌ No active game. /blackjack [bet] to start!');
  
  game.hand.push(draw(game.deck));
  const score = calcScore(game.hand);
  
  if (score > 21) {
    activeBj.delete(playerId);
    await E.msg(sock, jid, `💥 **BUST!** ${formatHand(game.hand)} = ${score}\nYou lose **${E.fmt(game.bet)} 🪙**.`);
    return;
  }
  
  await E.msg(sock, jid, formatBj(game.hand, game.dealer, true) + `\n\n/bjhit or /bjstand`);
}

async function bjStand(sock, jid, playerId) {
  const game = activeBj.get(playerId);
  if (!game) return E.msg(sock, jid, '❌ No active game.');
  
  // Dealer plays
  let dealerScore = calcScore(game.dealer);
  while (dealerScore < 17) {
    game.dealer.push(draw(game.deck));
    dealerScore = calcScore(game.dealer);
  }
  
  const playerScore = calcScore(game.hand);
  let result = '';
  let winnings = 0;
  
  if (dealerScore > 21) {
    result = 'Dealer busts! You win!';
    winnings = game.bet * 2;
  } else if (playerScore > dealerScore) {
    result = 'You win!';
    winnings = game.bet * 2;
  } else if (playerScore === dealerScore) {
    result = 'Push! Bet returned.';
    winnings = game.bet;
  } else {
    result = 'Dealer wins!';
    winnings = 0;
  }
  
  if (winnings > 0) E.giveOdds(playerId, winnings);
  activeBj.delete(playerId);
  
  await E.msg(sock, jid, 
    `${formatBj(game.hand, game.dealer, false)}\n\n` +
    `**${result}**\n` +
    (winnings > game.bet ? `🎉 Won **${E.fmt(winnings)} 🪙**!` : 
     winnings === game.bet ? `🤝 Bet returned.` : 
     `💸 Lost **${E.fmt(game.bet)} 🪙**.`)
  );
}

// ── Slots ─────────────────────────────────────────────────────────
async function slots(sock, jid, playerId, amountStr) {
  const cfg = R().game.casino;
  const player = DB.getPlayer(playerId);
  
  const amount = cleanInt(amountStr, cfg.min_bet, Math.min(cfg.max_bet, player.odds));
  if (!amount) return E.msg(sock, jid, `❌ Invalid bet.`);
  
  E.takeOdds(playerId, amount);
  
  const symbols = ['🍒', '🍋', '💎', '7️⃣', '🎰', '⭐'];
  const weights = [30, 25, 15, 10, 15, 5]; // Higher = more common
  
  const spin = () => {
    const total = weights.reduce((a,b) => a+b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < symbols.length; i++) {
      r -= weights[i];
      if (r <= 0) return symbols[i];
    }
    return symbols[0];
  };
  
  const r1 = spin(), r2 = spin(), r3 = spin();
  
  let multiplier = 0;
  if (r1 === r2 && r2 === r3) {
    // Triple
    if (r1 === '7️⃣') multiplier = 50;
    else if (r1 === '⭐') multiplier = 20;
    else if (r1 === '💎') multiplier = 15;
    else if (r1 === '🎰') multiplier = 10;
    else multiplier = 5;
  } else if (r1 === r2 || r2 === r3 || r1 === r3) {
    // Double
    multiplier = 2;
  }
  
  const animation = `🎰 | ${r1} | ${r2} | ${r3} | 🎰`;
  
  if (multiplier > 0) {
    E.giveOdds(playerId, amount * multiplier);
    await E.msg(sock, jid, `${animation}\n\n🎉 **${multiplier}x WIN!** +${E.fmt(amount * multiplier)} 🪙`);
  } else {
    await E.msg(sock, jid, `${animation}\n\n💸 No match. Lost ${E.fmt(amount)} 🪙`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function createDeck() {
  const suits = ['♠','♥','♦','♣'];
  const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const deck = [];
  for (const s of suits) for (const v of values) deck.push({ suit: s, value: v, num: cardValue(v) });
  return deck.sort(() => Math.random() - 0.5);
}

function cardValue(v) {
  if (['J','Q','K'].includes(v)) return 10;
  if (v === 'A') return 11;
  return parseInt(v);
}

function draw(deck) {
  return deck.pop();
}

function calcScore(hand) {
  let score = hand.reduce((s,c) => s + c.num, 0);
  let aces = hand.filter(c => c.value === 'A').length;
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  return score;
}

function formatHand(hand) {
  return hand.map(c => `${c.value}${c.suit}`).join(' ');
}

function formatBj(playerHand, dealerHand, hideDealer) {
  const pScore = calcScore(playerHand);
  const dScore = hideDealer ? '?' : calcScore(dealerHand);
  const dCards = hideDealer ? `${dealerHand[0].value}${dealerHand[0].suit} ?` : formatHand(dealerHand);
  
  return `🃏 **Blackjack**\n\n` +
         `Dealer: ${dCards} = ${dScore}\n` +
         `You: ${formatHand(playerHand)} = ${pScore}`;
}

module.exports = { coinflip, dice, bjStart, bjHit, bjStand, slots };
