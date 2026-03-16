'use strict';

const DB  = require('../core/database');
const E   = require('../core/gameEngine');
const R   = require('../registry');

const BREED_COOLDOWN = 24 * 3600000; // 24 hours

// ── Breed two pets ──────────────────────────────────────────────
async function breed(sock, jid, playerId, slot1Str, slot2Str) {
  const player = DB.getPlayer(playerId);
  const pets = DB.getPets(playerId);
  
  // Check cooldown
  const lastBreed = player.last_breed ? new Date(player.last_breed).getTime() : 0;
  const now = Date.now();
  if (now - lastBreed < BREED_COOLDOWN) {
    const hoursLeft = Math.ceil((BREED_COOLDOWN - (now - lastBreed)) / 3600000);
    return E.msg(sock, jid, `⏳ Breed cooldown: **${hoursLeft}h** remaining.`);
  }
  
  const slot1 = parseInt(slot1Str) - 1;
  const slot2 = parseInt(slot2Str) - 1;
  
  if (isNaN(slot1) || isNaN(slot2) || !pets[slot1] || !pets[slot2]) {
    return E.msg(sock, jid, '❌ Invalid pet slots. /pets to see your pets, then /breed [slot1] [slot2]');
  }
  
  if (slot1 === slot2) return E.msg(sock, jid, '❌ Cannot breed a pet with itself!');
  
  const pet1 = R.pet(pets[slot1].pet_id);
  const pet2 = R.pet(pets[slot2].pet_id);
  
  // Calculate offspring rarity
  const rarityOrder = ['common', 'rare', 'epic', 'legendary', 'mythic', 'celestial'];
  const r1 = rarityOrder.indexOf(pet1.rarity);
  const r2 = rarityOrder.indexOf(pet2.rarity);
  
  // 70% chance of average rarity, 20% chance of +1, 10% chance of -1 (min common)
  const avgRarity = Math.floor((r1 + r2) / 2);
  const roll = Math.random();
  let resultRarity;
  
  if (roll < 0.7) resultRarity = avgRarity;
  else if (roll < 0.9) resultRarity = Math.min(avgRarity + 1, rarityOrder.length - 1);
  else resultRarity = Math.max(avgRarity - 1, 0);
  
  // Pick random pet of that rarity
  const possiblePets = R().pets.filter(p => p.rarity === rarityOrder[resultRarity]);
  const offspring = possiblePets[Math.floor(Math.random() * possiblePets.length)];
  
  // 5% chance of mutation (rarity + 1)
  let mutated = false;
  if (Math.random() < 0.05 && resultRarity < rarityOrder.length - 1) {
    const higherPets = R().pets.filter(p => p.rarity === rarityOrder[resultRarity + 1]);
    if (higherPets.length) {
      const mutatedPet = higherPets[Math.floor(Math.random() * higherPets.length)];
      DB.addPet(playerId, mutatedPet.id);
      DB.updatePlayer(playerId, { last_breed: new Date().toISOString() });
      
      return E.msg(sock, jid,
        `🧬 **MUTATION!**\n\n` +
        `${pet1.emoji} ${pet1.name} + ${pet2.emoji} ${pet2.name}\n` +
        `= ${mutatedPet.emoji} **${mutatedPet.name}** [${mutatedPet.rarity}]!\n\n` +
        `✨ A rare genetic miracle occurred!`
      );
    }
  }
  
  DB.addPet(playerId, offspring.id);
  DB.updatePlayer(playerId, { last_breed: new Date().toISOString() });
  
  await E.msg(sock, jid,
    `🧬 **Breeding Complete!**\n\n` +
    `${pet1.emoji} ${pet1.name} + ${pet2.emoji} ${pet2.name}\n` +
    `= ${offspring.emoji} **${offspring.name}** [${offspring.rarity}]!\n\n` +
    `/breed again in 24 hours.`
  );
}

// ── Show breeding info ───────────────────────────────────────────
async function info(sock, jid) {
  await E.msg(sock, jid,
    `🧬 *Breeding Guide*\n\n` +
    `Combine two pets to create a new one!\n\n` +
    `**Mechanics:**\n` +
    `• 24h cooldown between breeds\n` +
    `• Result rarity based on parents\n` +
    `• 70% average, 20% higher, 10% lower\n` +
    `• 5% chance of **mutation** (+1 rarity!)\n\n` +
    `**Usage:**\n` +
    `/pets — Check your pet slots\n` +
    `/breed [slot1] [slot2] — Combine pets\n\n` +
    `Example: /breed 1 3`
  );
}

module.exports = { breed, info };
