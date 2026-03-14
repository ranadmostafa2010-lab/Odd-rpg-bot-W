const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class ShopSystem {
    static async show(sock, jid, category = null) {
        const config = global.gameConfig;
        const items = config.shopItems || [];
        
        let text = `🛒 *Item Shop*\n\n`;
        
        if (items.length === 0) {
            text += `No items available. Check back later!`;
            return await sock.sendMessage(jid, { text });
        }
        
        // Group by category if needed
        const categories = {};
        items.forEach(item => {
            const cat = item.effect || 'general';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(item);
        });
        
        if (category && categories[category]) {
            text += `*${Helpers.capitalize(category)} Items:*\n\n`;
            categories[category].forEach((item, i) => {
                text += `${i + 1}. *${item.name}* - ${Helpers.formatNumber(item.cost)} pts\n`;
                text += `   ${item.description}\n\n`;
            });
        } else {
            // Show all
            items.forEach((item, i) => {
                text += `${i + 1}. *${item.name}* - ${Helpers.formatNumber(item.cost)} pts\n`;
                text += `   ${item.description}\n\n`;
            });
        }
        
        text += `💰 Use /buy [item name] to purchase\n`;
        text += `📦 Use /sell [item] [amount] to sell`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async buy(sock, phone, jid, args) {
        const itemName = args.join(' ');
        if (!itemName) {
            return sock.sendMessage(jid, { text: `Usage: /buy [item name]\nUse /shop to see items.` });
        }
        
        const config = global.gameConfig;
        const player = GameEngine.getPlayer(phone);
        
        // Find item (case insensitive)
        const item = config.shopItems.find(i => 
            i.name.toLowerCase() === itemName.toLowerCase() ||
            i.name.toLowerCase().includes(itemName.toLowerCase())
        );
        
        if (!item) {
            return sock.sendMessage(jid, { text: `❌ Item "${itemName}" not found.\nUse /shop to see available items.` });
        }
        
        if (player.points < item.cost) {
            return sock.sendMessage(jid, { 
                text: `❌ Insufficient funds!\nPrice: ${Helpers.formatNumber(item.cost)}\nWallet: ${Helpers.formatNumber(player.points)}` 
            });
        }
        
        // Deduct points and add item
        GameEngine.addPoints(phone, -item.cost);
        GameEngine.addItem(phone, item.effect || 'consumable', item.name, 1, item);
        
        await sock.sendMessage(jid, { 
            text: `✅ Purchased *${item.name}*!\n\n💰 ${Helpers.formatNumber(item.cost)} points deducted\n📦 Item added to inventory\n\nUse /inventory to see your items.` 
        });
        
        GameEngine.logAction('item_purchased', phone, { item: item.name, cost: item.cost });
    }
    
    static async sell(sock, phone, jid, args) {
        const itemName = args.slice(0, -1).join(' ') || args[0];
        const amount = parseInt(args[args.length - 1]) || 1;
        
        if (!itemName) {
            return sock.sendMessage(jid, { text: `Usage: /sell [item name] [amount]` });
        }
        
        const player = GameEngine.getPlayer(phone);
        const item = GameEngine.getItem(phone, itemName);
        
        if (!item || item.quantity < amount) {
            return sock.sendMessage(jid, { text: `❌ You don't have ${amount} ${itemName}(s).` });
        }
        
        // Calculate sell price (50% of shop price)
        const config = global.gameConfig;
        const shopItem = config.shopItems.find(i => i.name.toLowerCase() === itemName.toLowerCase());
        const sellPrice = shopItem ? Math.floor(shopItem.cost * 0.5 * amount) : 10 * amount;
        
        // Remove items and add points
        GameEngine.removeItem(phone, itemName, amount);
        GameEngine.addPoints(phone, sellPrice);
        
        await sock.sendMessage(jid, { 
            text: `💰 Sold ${amount}x ${itemName} for ${Helpers.formatNumber(sellPrice)} points!` 
        });
        
        GameEngine.logAction('item_sold', phone, { item: itemName, amount, price: sellPrice });
    }
    
    static async crates(sock, phone, jid, args) {
        const type = args[0] || 'Common';
        const config = global.gameConfig;
        
        const crateTypes = Object.keys(config.crates);
        if (!crateTypes.includes(type)) {
            return sock.sendMessage(jid, { 
                text: `❌ Invalid crate type.\nAvailable: ${crateTypes.join(', ')}` 
            });
        }
        
        const crate = config.crates[type];
        const player = GameEngine.getPlayer(phone);
        
        if (player.points < crate.cost) {
            return sock.sendMessage(jid, { 
                text: `❌ Insufficient funds!\nCost: ${Helpers.formatNumber(crate.cost)}\nWallet: ${Helpers.formatNumber(player.points)}` 
            });
        }
        
        // Check pet limit
        const petCount = GameEngine.getPlayerPets(phone).length;
        if (petCount >= config.pets.maxPets) {
            return sock.sendMessage(jid, { 
                text: `❌ Pet inventory full! Max: ${config.pets.maxPets}\nRelease some pets with /release [number]` 
            });
        }
        
        // Deduct points
        GameEngine.addPoints(phone, -crate.cost);
        
        // Generate pets
        const minPets = crate.minPets;
        const maxPets = Math.min(crate.maxPets, config.pets.maxPets - petCount);
        const count = Helpers.randomInt(minPets, maxPets);
        
        let text = `🎁 *${type} Crate Opened!* 🎁\n\n`;
        text += `Cost: ${Helpers.formatNumber(crate.cost)} points\n`;
        text += `Contains: ${count} pet(s)\n\n`;
        text += `*Results:*\n`;
        
        const obtained = [];
        for (let i = 0; i < count; i++) {
            const pet = GameEngine.givePet(phone, type);
            obtained.push(pet);
            
            text += `${i + 1}. ${pet.name} (${pet.rarity})\n`;
            text += `   +${pet.attack_bonus} ATK | +${pet.defense_bonus} DEF | +${pet.speed_bonus} SPD\n`;
        }
        
        // Check for jackpot (Mythic drop)
        const hasMythic = obtained.some(p => p.rarity === 'Mythic');
        if (hasMythic) {
            text += `\n🎉 *JACKPOT! Mythic pet obtained!* 🎉\n`;
        }
        
        text += `\nUse /pets to view your collection!`;
        
        await sock.sendMessage(jid, { text });
        
        GameEngine.logAction('crate_opened', phone, { 
            type, 
            cost: crate.cost, 
            pets: count,
            hasMythic 
        });
    }
    
    static async showMarket(sock, jid, args) {
        const db = Database.get();
        const listings = db.prepare(`
            SELECT m.*, p.name as seller_name
            FROM market m
            JOIN players p ON m.seller_phone = p.phone
            WHERE m.sold = 0 AND m.expires_at > datetime('now')
            ORDER BY m.listed_at DESC
            LIMIT 20
        `).all();
        
        if (listings.length === 0) {
            return sock.sendMessage(jid, { text: '📭 Market is empty. Be the first to sell! /list [item] [price]' });
        }
        
        let text = `🏪 *Player Market*\n\n`;
        
        listings.forEach((listing, i) => {
            text += `${i + 1}. *${listing.item_name}* x${listing.quantity}\n`;
            text += `   Price: ${Helpers.formatNumber(listing.price)} pts\n`;
            text += `   Seller: ${listing.seller_name}\n`;
            text += `   Buy: /buyitem ${listing.id}\n\n`;
        });
        
        await sock.sendMessage(jid, { text });
    }
    
    static async listItem(sock, phone, jid, args) {
        const itemName = args.slice(0, -1).join(' ');
        const price = parseInt(args[args.length - 1]);
        
        if (!itemName || !price || price <= 0) {
            return sock.sendMessage(jid, { text: `Usage: /list [item name] [price]` });
        }
        
        const player = GameEngine.getPlayer(phone);
        const item = GameEngine.getItem(phone, itemName);
        
        if (!item) {
            return sock.sendMessage(jid, { text: `❌ You don't have ${itemName}` });
        }
        
        // Remove from inventory and add to market
        GameEngine.removeItem(phone, itemName, 1);
        
        const db = Database.get();
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
        
        const result = db.prepare(`
            INSERT INTO market (seller_phone, item_type, item_name, quantity, price, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(phone, item.item_type, itemName, 1, price, expires);
        
        await sock.sendMessage(jid, { 
            text: `📦 Listed *${itemName}* for ${Helpers.formatNumber(price)} points!\nListing ID: ${result.lastInsertRowid}\nExpires in 7 days.` 
        });
    }
    
    static async unlistItem(sock, phone, jid, listingId) {
        const db = Database.get();
        const listing = db.prepare('SELECT * FROM market WHERE id = ? AND seller_phone = ? AND sold = 0').get(listingId, phone);
        
        if (!listing) {
            return sock.sendMessage(jid, { text: '❌ Listing not found or already sold' });
        }
        
        // Return item to inventory
        GameEngine.addItem(phone, listing.item_type, listing.item_name, listing.quantity);
        
        // Remove listing
        db.prepare('DELETE FROM market WHERE id = ?').run(listingId);
        
        await sock.sendMessage(jid, { text: `✅ Removed listing and returned ${listing.item_name} to inventory.` });
    }
    
    static async buyItem(sock, phone, jid, listingId) {
        const db = Database.get();
        const listing = db.prepare(`
            SELECT m.*, p.name as seller_name
            FROM market m
            JOIN players p ON m.seller_phone = p.phone
            WHERE m.id = ? AND m.sold = 0
        `).get(listingId);
        
        if (!listing) {
            return sock.sendMessage(jid, { text: '❌ Item not found or already sold' });
        }
        
        if (listing.seller_phone === phone) {
            return sock.sendMessage(jid, { text: '❌ You cannot buy your own item' });
        }
        
        const buyer = GameEngine.getPlayer(phone);
        if (buyer.points < listing.price) {
            return sock.sendMessage(jid, { text: '❌ Insufficient funds' });
        }
        
        // Transfer points
        GameEngine.addPoints(phone, -listing.price);
        GameEngine.addPoints(listing.seller_phone, listing.price);
        
        // Transfer item
        GameEngine.addItem(phone, listing.item_type, listing.item_name, listing.quantity);
        
        // Mark as sold
        db.prepare(`
            UPDATE market 
            SET sold = 1, buyer_phone = ?, sold_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(phone, listingId);
        
        await sock.sendMessage(jid, { 
            text: `✅ Purchased ${listing.item_name} for ${Helpers.formatNumber(listing.price)} points!` 
        });
        
        await sock.sendMessage(Helpers.getJid(listing.seller_phone), {
            text: `💰 Your ${listing.item_name} was sold!\nBuyer: ${buyer.name}\nPrice: ${Helpers.formatNumber(listing.price)} points`
        });
    }
}

module.exports = ShopSystem;
