const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class PetSystem {
    static async showPets(sock, phone, jid) {
        const config = global.gameConfig;
        const pets = GameEngine.getPlayerPets(phone);
        const player = GameEngine.getPlayer(phone);
        
        if (pets.length === 0) {
            return sock.sendMessage(jid, { 
                text: `🐾 No pets yet!\n\nOpen crates to get pets:\n/crates Common - 100 pts\n/crates Rare - 500 pts\n/crates Epic - 2000 pts` 
            });
        }
        
        let text = `🐾 *${player.name}'s Pets* (${pets.length}/${config.pets.maxPets})\n\n`;
        
        pets.forEach((pet, i) => {
            const isEquipped = pet.equipped ? ' ✅ EQUIPPED' : '';
            const isFav = pet.favorite ? ' ⭐' : '';
            
            text += `${i + 1}. ${pet.name}${isEquipped}${isFav}\n`;
            text += `   ${pet.rarity} ${pet.type} | Lv.${pet.level}\n`;
            text += `   ❤️+${pet.hp_bonus} ⚔️+${pet.attack_bonus} 🛡️+${pet.defense_bonus} 💨+${pet.speed_bonus}\n`;
            
            if (!pet.equipped) {
                text += `   /equip ${i + 1} | /feed ${i + 1} | /release ${i + 1}\n`;
            }
            text += `\n`;
        });
        
        text += `*Commands:*\n`;
        text += `/equip [number] - Equip pet\n`;
        text += `/feed [number] - Feed pet (costs 50 pts)\n`;
        text += `/train [number] - Train pet (costs 100 pts)\n`;
        text += `/release [number] - Release pet\n`;
        text += `/rename [number] [name] - Rename pet`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async showPetInfo(sock, phone, jid, petNum) {
        const num = parseInt(petNum);
        if (!num) {
            return sock.sendMessage(jid, { text: `Usage: /petinfo [pet number]` });
        }
        
        const pets = GameEngine.getPlayerPets(phone);
        if (num > pets.length || num < 1) {
            return sock.sendMessage(jid, { text: '❌ Invalid pet number' });
        }
        
        const pet = pets[num - 1];
        
        let text = `🐾 *${pet.name}*\n\n`;
        text += `Rarity: ${pet.rarity}\n`;
        text += `Type: ${pet.type}\n`;
        text += `Level: ${pet.level}\n`;
        text += `EXP: ${pet.exp}/${pet.level * 100}\n\n`;
        
        text += `*Stats:*\n`;
        text += `HP Bonus: +${pet.hp_bonus}\n`;
        text += `Attack Bonus: +${pet.attack_bonus}\n`;
        text += `Defense Bonus: +${pet.defense_bonus}\n`;
        text += `Speed Bonus: +${pet.speed_bonus}\n\n`;
        
        text += `Equipped: ${pet.equipped ? 'Yes ✅' : 'No'}\n`;
        text += `Favorite: ${pet.favorite ? 'Yes ⭐' : 'No'}\n`;
        text += `Obtained: ${new Date(pet.obtained_at).toLocaleDateString()}`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async equip(sock, phone, jid, petNum) {
        const num = parseInt(petNum);
        if (!num) {
            return sock.sendMessage(jid, { text: `Usage: /equip [pet number from /pets]` });
        }
        
        const pets = GameEngine.getPlayerPets(phone);
        if (num > pets.length || num < 1) {
            return sock.sendMessage(jid, { text: '❌ Invalid pet number. Use /pets to see your pets.' });
        }
        
        const pet = pets[num - 1];
        GameEngine.equipPet(phone, pet.id);
        
        await sock.sendMessage(jid, { 
            text: `✅ Equipped *${pet.name}*!\n\nStats boosted:\n+${pet.attack_bonus} Attack\n+${pet.defense_bonus} Defense\n+${pet.speed_bonus} Speed\n+${pet.hp_bonus} HP` 
        });
    }
    
    static async unequip(sock, phone, jid) {
        const equipped = GameEngine.getEquippedPet(phone);
        if (!equipped) {
            return sock.sendMessage(jid, { text: '❌ No pet currently equipped' });
        }
        
        GameEngine.unequipPet(phone);
        await sock.sendMessage(jid, { text: `✅ Unequipped ${equipped.name}. Stats returned to normal.` });
    }
    
    static async feed(sock, phone, jid, args) {
        const num = parseInt(args[0]);
        if (!num) {
            return sock.sendMessage(jid, { text: `Usage: /feed [pet number]` });
        }
        
        const pets = GameEngine.getPlayerPets(phone);
        if (num > pets.length || num < 1) {
            return sock.sendMessage(jid, { text: '❌ Invalid pet number' });
        }
        
        const pet = pets[num - 1];
        const player = GameEngine.getPlayer(phone);
        const feedCost = 50;
        
        if (player.points < feedCost) {
            return sock.sendMessage(jid, { text: `❌ Need ${feedCost} points to feed pet` });
        }
        
        if (pet.level >= global.gameConfig.pets.maxLevel) {
            return sock.sendMessage(jid, { text: '❌ Pet is already at max level!' });
        }
        
        // Deduct points and give EXP
        GameEngine.addPoints(phone, -feedCost);
        
        const expGain = 25;
        const newExp = pet.exp + expGain;
        const expNeeded = pet.level * 100;
        
        let levelUp = false;
        let newLevel = pet.level;
        
        if (newExp >= expNeeded) {
            newLevel = pet.level + 1;
            levelUp = true;
            
            // Increase stats on level up
            const multiplier = global.gameConfig.pets.rarities[pet.rarity].multiplier;
            const db = Database.get();
            db.prepare(`
                UPDATE pets 
                SET level = ?, exp = ?, 
                    hp_bonus = hp_bonus + ?,
                    attack_bonus = attack_bonus + ?,
                    defense_bonus = defense_bonus + ?,
                    speed_bonus = speed_bonus + ?
                WHERE id = ?
            `).run(
                newLevel,
                newExp - expNeeded,
                Math.floor(2 * multiplier),
                Math.floor(1 * multiplier),
                Math.floor(1 * multiplier),
                Math.floor(1 * multiplier),
                pet.id
            );
        } else {
            const db = Database.get();
            db.prepare('UPDATE pets SET exp = ? WHERE id = ?').run(newExp, pet.id);
        }
        
        let text = `🍖 Fed *${pet.name}*! (-${feedCost} pts)\n\n`;
        text += `+${expGain} EXP\n`;
        
        if (levelUp) {
            text += `🆙 *LEVEL UP!* ${pet.level} → ${newLevel}\n`;
            text += `Stats increased!`;
            
            // If equipped, update player stats
            if (pet.equipped) {
                GameEngine.equipPet(phone, pet.id);
            }
        } else {
            text += `EXP: ${newExp}/${expNeeded}`;
        }
        
        await sock.sendMessage(jid, { text });
    }
    
    static async train(sock, phone, jid, args) {
        const num = parseInt(args[0]);
        if (!num) {
            return sock.sendMessage(jid, { text: `Usage: /train [pet number]` });
        }
        
        const pets = GameEngine.getPlayerPets(phone);
        if (num > pets.length || num < 1) {
            return sock.sendMessage(jid, { text: '❌ Invalid pet number' });
        }
        
        const pet = pets[num - 1];
        const player = GameEngine.getPlayer(phone);
        const trainCost = 100;
        
        if (player.points < trainCost) {
            return sock.sendMessage(jid, { text: `❌ Need ${trainCost} points to train` });
        }
        
        // Training gives more EXP than feeding
        GameEngine.addPoints(phone, -trainCost);
        
        const expGain = 60;
        const newExp = pet.exp + expGain;
        const expNeeded = pet.level * 100;
        
        let text = `💪 Training *${pet.name}*... (-${trainCost} pts)\n\n`;
        
        if (newExp >= expNeeded && pet.level < global.gameConfig.pets.maxLevel) {
            const newLevel = pet.level + 1;
            const multiplier = global.gameConfig.pets.rarities[pet.rarity].multiplier;
            
            const db = Database.get();
            db.prepare(`
                UPDATE pets 
                SET level = ?, exp = ?, 
                    hp_bonus = hp_bonus + ?,
                    attack_bonus = attack_bonus + ?,
                    defense_bonus = defense_bonus + ?,
                    speed_bonus = speed_bonus + ?
                WHERE id = ?
            `).run(
                newLevel,
                newExp - expNeeded,
                Math.floor(2 * multiplier),
                Math.floor(1 * multiplier),
                Math.floor(1 * multiplier),
                Math.floor(1 * multiplier),
                pet.id
            );
            
            text += `🆙 *LEVEL UP!* ${pet.level} → ${newLevel}\n`;
            text += `Training successful! Stats boosted!`;
            
            if (pet.equipped) GameEngine.equipPet(phone, pet.id);
        } else {
            const db = Database.get();
            db.prepare('UPDATE pets SET exp = ? WHERE id = ?').run(newExp, pet.id);
            text += `+${expGain} EXP\n`;
            text += `EXP: ${newExp}/${expNeeded}`;
        }
        
        await sock.sendMessage(jid, { text });
    }
    
    static async release(sock, phone, jid, args) {
        const num = parseInt(args[0]);
        if (!num) {
            return sock.sendMessage(jid, { text: `Usage: /release [pet number]\n⚠️ This cannot be undone!` });
        }
        
        const pets = GameEngine.getPlayerPets(phone);
        if (num > pets.length || num < 1) {
            return sock.sendMessage(jid, { text: '❌ Invalid pet number' });
        }
        
        const pet = pets[num - 1];
        
        // Confirm release (in a real bot, you might want confirmation)
        const success = GameEngine.releasePet(phone, pet.id);
        
        if (success) {
            await sock.sendMessage(jid, { 
                text: `😢 Released *${pet.name}*.\n\nThe ${pet.rarity} ${pet.type} has been set free.` 
            });
        } else {
            await sock.sendMessage(jid, { text: '❌ Failed to release pet' });
        }
    }
    
    static async rename(sock, phone, jid, args) {
        const num = parseInt(args[0]);
        const newName = args.slice(1).join(' ');
        
        if (!num || !newName) {
            return sock.sendMessage(jid, { text: `Usage: /rename [pet number] [new name]` });
        }
        
        if (newName.length > 20) {
            return sock.sendMessage(jid, { text: '❌ Name too long (max 20 characters)' });
        }
        
        const pets = GameEngine.getPlayerPets(phone);
        if (num > pets.length || num < 1) {
            return sock.sendMessage(jid, { text: '❌ Invalid pet number' });
        }
        
        const pet = pets[num - 1];
        const db = Database.get();
        
        // Keep the rarity color, change the name
        const rarityColor = newName.charAt(0);
        const cleanName = newName.substring(2).trim();
        const fullName = `${rarityColor} ${cleanName}`;
        
        db.prepare('UPDATE pets SET name = ? WHERE id = ?').run(fullName, pet.id);
        
        await sock.sendMessage(jid, { text: `✅ Renamed pet to *${fullName}*!` });
    }
    
    static async favorite(sock, phone, jid, petNum) {
        const num = parseInt(petNum);
        if (!num) {
            return sock.sendMessage(jid, { text: `Usage: /favorite [pet number]` });
        }
        
        const pets = GameEngine.getPlayerPets(phone);
        if (num > pets.length || num < 1) {
            return sock.sendMessage(jid, { text: '❌ Invalid pet number' });
        }
        
        const pet = pets[num - 1];
        const db = Database.get();
        
        const newFav = pet.favorite ? 0 : 1;
        db.prepare('UPDATE pets SET favorite = ? WHERE id = ?').run(newFav, pet.id);
        
        await sock.sendMessage(jid, { 
            text: `${newFav ? '⭐' : '☆'} ${pet.name} ${newFav ? 'marked as favorite' : 'removed from favorites'}` 
        });
    }
}

module.exports = PetSystem;
