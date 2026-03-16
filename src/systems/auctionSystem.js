'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');
const { cleanInt } = require('../core/security');

async function listAuction(sock, jid, sellerId, typeStr, refStr, bidStr, hoursStr) {
  const seller  = DB.getPlayer(sellerId);
  const type    = (typeStr || '').toLowerCase();
  const bid     = cleanInt(bidStr, 100, 9999999);
  if (!bid) return E.msg(sock, jid, '❌ Invalid starting bid (min 100).');
  const hours   = Math.min(cleanInt(hoursStr, 1, 72) || 24, 72);
  const endsAt  = new Date(Date.now() + hours * 3600000).toISOString();

  if (type === 'pet') {
    const pets = DB.getPets(sellerId);
    const slot  = cleanInt(refStr, 1, pets.length);
    if (!slot) return E.msg(sock, jid, '❌ Invalid pet slot. /pets to check.');
    const petRow = pets[slot - 1];
    const petData = R.pet(petRow.pet_id);
    if (seller.equipped_pet === petRow.pet_id) return E.msg(sock, jid, '❌ Unequip pet first.');

    DB.removePet(sellerId, petRow.pet_id);
    DB.db.prepare('INSERT INTO auctions (seller_id,item_type,item_id,starting_bid,ends_at) VALUES(?,?,?,?,?)').run(sellerId,'pet',petRow.pet_id,bid,endsAt);
    await E.msg(sock, jid, `📋 Listed **${petData?.emoji} ${petData?.name}** starting at **${E.fmt(bid)} 🪙** for ${hours}h!`);

  } else if (type === 'item') {
    if (!DB.hasItem(sellerId, refStr)) return E.msg(sock, jid, `❌ You don't have **${refStr}** in your inventory.`);
    DB.removeItem(sellerId, refStr);
    DB.db.prepare('INSERT INTO auctions (seller_id,item_type,item_id,starting_bid,ends_at) VALUES(?,?,?,?,?)').run(sellerId,'item',refStr,bid,endsAt);
    const iData = R.item(refStr);
    await E.msg(sock, jid, `📋 Listed **${iData?.emoji || '📦'} ${iData?.name || refStr}** starting at **${E.fmt(bid)} 🪙**!`);
  } else {
    await E.msg(sock, jid, '❌ Usage:\n/auction list pet [slot] [start_bid] [hours]\n/auction list item [item_id] [start_bid] [hours]');
  }
}

async function browseAuctions(sock, jid) {
  const auctions = DB.db.prepare("SELECT * FROM auctions WHERE status='active' AND ends_at > datetime('now') ORDER BY ends_at ASC LIMIT 12").all();
  if (!auctions.length) return E.msg(sock, jid, '🏪 Auction House is empty!\n\n/auction list [pet/item] [ref] [bid] [hours] to sell something');

  let msg = `🏪 *Auction House:*\n\n`;
  for (const a of auctions) {
    const seller   = DB.getPlayer(a.seller_id);
    const curBid   = a.current_bid || a.starting_bid;
    const timeLeft = getTimeLeft(a.ends_at);
    let   name     = a.item_id;

    if (a.item_type === 'pet') {
      const p = R.pet(a.item_id);
      name = `${p?.emoji || '🐾'} ${p?.name || a.item_id} [${p?.rarity}]`;
    } else {
      const i = R.item(a.item_id);
      name = `${i?.emoji || '📦'} ${i?.name || a.item_id}`;
    }

    msg += `📌 **#${a.id}** ${name}\n`;
    msg += `   ${seller?.name || '?'} | **${E.fmt(curBid)} 🪙** | ⏳ ${timeLeft}\n\n`;
  }
  msg += `/auction bid [#id] [amount] — Place a bid`;
  await E.msg(sock, jid, msg);
}

async function placeBid(sock, jid, bidderId, auctionId, amtStr) {
  const a = DB.db.prepare("SELECT * FROM auctions WHERE id=? AND status='active' AND ends_at > datetime('now')").get(auctionId);
  if (!a) return E.msg(sock, jid, `❌ Auction #${auctionId} not found or expired.`);

  const bidder = DB.getPlayer(bidderId);
  const minBid = (a.current_bid || a.starting_bid) + 1;
  const amt    = cleanInt(amtStr, minBid, bidder.odds);
  if (!amt) return E.msg(sock, jid, `❌ Minimum bid is **${E.fmt(minBid)} 🪙**.`);
  if (bidderId === a.seller_id) return E.msg(sock, jid, '❌ Cannot bid on your own auction.');

  // Refund previous bidder
  if (a.current_bidder) {
    E.giveOdds(a.current_bidder, a.current_bid);
    await E.msgPlayer(sock, a.current_bidder, `📢 You were outbid on auction #${a.id}! ${E.fmt(a.current_bid)} 🪙 refunded.`).catch(() => {});
  }

  E.takeOdds(bidderId, amt);
  DB.db.prepare('UPDATE auctions SET current_bid=?,current_bidder=? WHERE id=?').run(amt, bidderId, a.id);

  await E.msg(sock, jid, `✅ Bid **${E.fmt(amt)} 🪙** on Auction #${a.id}! ⏳ ${getTimeLeft(a.ends_at)} left.`);
  await E.msgPlayer(sock, a.seller_id, `📢 New bid on your Auction #${a.id}: **${E.fmt(amt)} 🪙** by **${bidder.name}**!`).catch(() => {});
}

async function settleExpired(sock) {
  const expired = DB.db.prepare("SELECT * FROM auctions WHERE status='active' AND ends_at <= datetime('now')").all();
  for (const a of expired) {
    DB.db.prepare("UPDATE auctions SET status='complete' WHERE id=?").run(a.id);

    if (a.current_bidder) {
      if (a.item_type === 'pet')  DB.addPet(a.current_bidder, a.item_id);
      else                         DB.addItem(a.current_bidder, a.item_id);
      const fee    = Math.floor(a.current_bid * 0.05);
      const payout = a.current_bid - fee;
      E.giveOdds(a.seller_id, payout);
      await E.msgPlayer(sock, a.current_bidder, `🏆 You won Auction #${a.id}!`).catch(() => {});
      await E.msgPlayer(sock, a.seller_id, `💰 Auction #${a.id} sold for **${E.fmt(a.current_bid)} 🪙**! Received **${E.fmt(payout)}** (5% fee).`).catch(() => {});
    } else {
      if (a.item_type === 'pet')  DB.addPet(a.seller_id, a.item_id);
      else                         DB.addItem(a.seller_id, a.item_id);
      await E.msgPlayer(sock, a.seller_id, `❌ Auction #${a.id} expired with no bids. Item returned.`).catch(() => {});
    }
  }
}

function getTimeLeft(endsAt) {
  const ms   = new Date(endsAt) - Date.now();
  if (ms <= 0) return 'Expired';
  const hrs  = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

module.exports = { listAuction, browseAuctions, placeBid, settleExpired };
