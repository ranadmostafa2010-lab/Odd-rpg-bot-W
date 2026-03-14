const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class TradeSystem {
    static async request(sock, senderPhone, jid, args) {
        const targetPhone = args[0]?.replace(/[^0-9]/g, '');
        const points = parseInt(args[1]) || 0;
        
        if (!targetPhone) {
            return sock.sendMessage(jid, { 
                text: `Usage: /trade [phone number] [points] [pet numbers...]\nExample: /trade 201061479235 1000 1 2` 
            });
        }
        
        if (!Helpers.isValidPhone(targetPhone)) {
            return sock.sendMessage(jid, { text: '❌ Invalid phone number' });
        }
        
        const sender = GameEngine.getPlayer(senderPhone);
        const receiver = GameEngine.getPlayer(targetPhone);
        
        if (!receiver) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        if (targetPhone === senderPhone) {
            return sock.sendMessage(jid, { text: '❌ You cannot trade with yourself' });
        }
        
        if (sender.points < points) {
            return sock.sendMessage(jid, { 
                text: `❌ Insufficient points\nWallet: ${Helpers.formatNumber(sender.points)}\nOffer: ${Helpers.formatNumber(points)}` 
            });
        }
        
        // Parse pet numbers (remaining args)
        const petNumbers = args.slice(2).map(n => parseInt(n)).filter(n => !isNaN(n));
        const senderPets = GameEngine.getPlayerPets(senderPhone);
        
        // Validate pets
        const offeredPets = [];
        for (const num of petNumbers) {
            if (num < 1 || num > senderPets.length) {
                return sock.sendMessage(jid, { text: `❌ Invalid pet number: ${num}` });
            }
            const pet = senderPets[num - 1];
            if (pet.equipped) {
                return sock.sendMessage(jid, { text: `❌ Cannot trade equipped pet: ${pet.name}` });
            }
            offeredPets.push(pet.id);
        }
        
        // Create trade
        const db = Database.get();
        const tradeId = Helpers.generateId();
        const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
        
        const result = db.prepare(`
            INSERT INTO trades (
                trade_id, sender_phone, receiver_phone, sender_pets, 
                sender_points, status, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            tradeId,
            senderPhone,
            targetPhone,
            JSON.stringify(offeredPets),
            points,
            'pending',
            expires
        );
        
        // Notify receiver
        let notifyText = `📦 *Trade Request*\n\n`;
        notifyText += `From: ${sender.name}\n`;
        notifyText += `Points: ${Helpers.formatNumber(points)}\n`;
        if (offeredPets.length > 0) {
            notifyText += `Pets: ${offeredPets.length} pet(s)\n`;
        }
        notifyText += `Expires: 1 hour\n\n`;
        notifyText += `Accept: /accepttrade ${result.lastInsertRowid}\n`;
        notifyText += `Decline: /declinetrade ${result.lastInsertRowid}`;
        
        await sock.sendMessage(Helpers.getJid(targetPhone), { text: notifyText });
        
        // Confirm to sender
        await sock.sendMessage(jid, { 
            text: `📦 Trade request sent to ${receiver.name}!\nTrade ID: ${result.lastInsertRowid}\n\nWaiting for response...` 
        });
        
        GameEngine.logAction('trade_request', senderPhone, { 
            to: targetPhone, 
            points, 
            pets: offeredPets.length 
        });
    }
    
    static async accept(sock, phone, jid, tradeId) {
        const db = Database.get();
        const trade = db.prepare(`
            SELECT * FROM trades 
            WHERE id = ? AND receiver_phone = ? AND status = 'pending'
        `).get(tradeId, phone);
        
        if (!trade) {
            return sock.sendMessage(jid, { text: '❌ Trade not found or already processed' });
        }
        
        // Check if expired
        if (new Date(trade.expires_at) < new Date()) {
            db.prepare("UPDATE trades SET status = 'expired' WHERE id = ?").run(tradeId);
            return sock.sendMessage(jid, { text: '❌ This trade has expired' });
        }
        
        const sender = GameEngine.getPlayer(trade.sender_phone);
        const receiver = GameEngine.getPlayer(phone);
        
        // Verify sender still has the points
        if (sender.points < trade.sender_points) {
            db.prepare("UPDATE trades SET status = 'cancelled' WHERE id = ?").run(tradeId);
            await sock.sendMessage(jid, { text: '❌ Sender no longer has enough points. Trade cancelled.' });
            await sock.sendMessage(Helpers.getJid(sender.phone), { 
                text: '❌ Your trade was cancelled due to insufficient points.' 
            });
            return;
        }
        
        // Verify pets still exist and are not equipped
        const offeredPetIds = JSON.parse(trade.sender_pets || '[]');
        const senderPets = GameEngine.getPlayerPets(sender.phone);
        
        for (const petId of offeredPetIds) {
            const pet = senderPets.find(p => p.id === petId);
            if (!pet) {
                db.prepare("UPDATE trades SET status = 'cancelled' WHERE id = ?").run(tradeId);
                return sock.sendMessage(jid, { text: '❌ One of the offered pets is no longer available.' });
            }
            if (pet.equipped) {
                db.prepare("UPDATE trades SET status = 'cancelled' WHERE id = ?").run(tradeId);
                return sock.sendMessage(jid, { text: '❌ One of the offered pets is now equipped.' });
            }
        }
        
        // Check receiver has space for pets
        const receiverPetCount = GameEngine.getPlayerPets(phone).length;
        const maxPets = global.gameConfig.pets.maxPets;
        if (receiverPetCount + offeredPetIds.length > maxPets) {
            return sock.sendMessage(jid, { 
                text: `❌ Not enough pet space! You have ${receiverPetCount}/${maxPets} pets.\nRelease some pets first.` 
            });
        }
        
        // Execute trade - Transfer points
        if (trade.sender_points > 0) {
            GameEngine.addPoints(sender.phone, -trade.sender_points);
            GameEngine.addPoints(phone, trade.sender_points);
        }
        
        // Transfer pets
        for (const petId of offeredPetIds) {
            const db = Database.get();
            db.prepare('UPDATE pets SET owner_phone = ? WHERE id = ?').run(phone, petId);
        }
        
        // Update trade status
        db.prepare(`
            UPDATE trades 
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(tradeId);
        
        // Notify both parties
        let senderText = `✅ Trade completed with ${receiver.name}!\n\n`;
        senderText += `Sent: ${Helpers.formatNumber(trade.sender_points)} points`;
        if (offeredPetIds.length > 0) senderText += `, ${offeredPetIds.length} pet(s)`;
        
        let receiverText = `✅ Trade completed with ${sender.name}!\n\n`;
        receiverText += `Received: ${Helpers.formatNumber(trade.sender_points)} points`;
        if (offeredPetIds.length > 0) receiverText += `, ${offeredPetIds.length} pet(s)`;
        
        await sock.sendMessage(Helpers.getJid(sender.phone), { text: senderText });
        await sock.sendMessage(jid, { text: receiverText });
        
        GameEngine.logAction('trade_complete', sender.phone, { 
            to: phone, 
            points: trade.sender_points, 
            pets: offeredPetIds.length 
        });
        GameEngine.logAction('trade_receive', phone, { 
            from: sender.phone, 
            points: trade.sender_points, 
            pets: offeredPetIds.length 
        });
    }
    
    static async decline(sock, phone, jid, tradeId) {
        const db = Database.get();
        const trade = db.prepare(`
            SELECT * FROM trades 
            WHERE id = ? AND receiver_phone = ? AND status = 'pending'
        `).get(tradeId, phone);
        
        if (!trade) {
            // Check if sender wants to cancel
            const senderTrade = db.prepare(`
                SELECT * FROM trades 
                WHERE id = ? AND sender_phone = ? AND status = 'pending'
            `).get(tradeId, phone);
            
            if (senderTrade) {
                db.prepare("UPDATE trades SET status = 'cancelled' WHERE id = ?").run(tradeId);
                await sock.sendMessage(jid, { text: '✅ Trade cancelled.' });
                
                await sock.sendMessage(Helpers.getJid(senderTrade.receiver_phone), {
                    text: `❌ Trade from ${GameEngine.getPlayer(phone)?.name} was cancelled.`
                });
                return;
            }
            
            return sock.sendMessage(jid, { text: '❌ Trade not found or already processed' });
        }
        
        db.prepare("UPDATE trades SET status = 'declined' WHERE id = ?").run(tradeId);
        
        const sender = GameEngine.getPlayer(trade.sender_phone);
        await sock.sendMessage(jid, { text: '❌ Trade declined.' });
        await sock.sendMessage(Helpers.getJid(trade.sender_phone), { 
            text: `❌ ${GameEngine.getPlayer(phone)?.name} declined your trade offer.` 
        });
    }
    
    static async list(sock, phone, jid) {
        const db = Database.get();
        
        // Pending trades sent to this player
        const incoming = db.prepare(`
            SELECT t.*, p.name as sender_name
            FROM trades t
            JOIN players p ON t.sender_phone = p.phone
            WHERE t.receiver_phone = ? AND t.status = 'pending'
            ORDER BY t.created_at DESC
        `).all(phone);
        
        // Pending trades sent by this player
        const outgoing = db.prepare(`
            SELECT t.*, p.name as receiver_name
            FROM trades t
            JOIN players p ON t.receiver_phone = p.phone
            WHERE t.sender_phone = ? AND t.status = 'pending'
            ORDER BY t.created_at DESC
        `).all(phone);
        
        let text = `📦 *Your Trades*\n\n`;
        
        if (incoming.length === 0 && outgoing.length === 0) {
            text += `No pending trades.\n\nUse /trade [phone] [points] to start trading!`;
        } else {
            if (incoming.length > 0) {
                text += `*Incoming:*\n`;
                incoming.forEach(t => {
                    const pets = JSON.parse(t.sender_pets || '[]').length;
                    text += `#${t.id} From ${t.sender_name}\n`;
                    text += `   ${Helpers.formatNumber(t.sender_points)} pts`;
                    if (pets > 0) text += ` + ${pets} pet(s)`;
                    text += `\n   /accepttrade ${t.id} | /declinetrade ${t.id}\n\n`;
                });
            }
            
            if (outgoing.length > 0) {
                text += `*Outgoing:*\n`;
                outgoing.forEach(t => {
                    const pets = JSON.parse(t.sender_pets || '[]').length;
                    text += `#${t.id} To ${t.receiver_name}\n`;
                    text += `   ${Helpers.formatNumber(t.sender_points)} pts`;
                    if (pets > 0) text += ` + ${pets} pet(s)`;
                    text += `\n   /declinetrade ${t.id} to cancel\n\n`;
                });
            }
        }
        
        await sock.sendMessage(jid, { text });
    }
    
    static async history(sock, phone, jid) {
        const db = Database.get();
        const trades = db.prepare(`
            SELECT t.*, 
                s.name as sender_name,
                r.name as receiver_name
            FROM trades t
            JOIN players s ON t.sender_phone = s.phone
            JOIN players r ON t.receiver_phone = r.phone
            WHERE (t.sender_phone = ? OR t.receiver_phone = ?) 
            AND t.status = 'completed'
            ORDER BY t.completed_at DESC
            LIMIT 10
        `).all(phone, phone);
        
        if (trades.length === 0) {
            return sock.sendMessage(jid, { text: '📭 No completed trades yet.' });
        }
        
        let text = `📜 *Trade History*\n\n`;
        
        trades.forEach(t => {
            const isSender = t.sender_phone === phone;
            const other = isSender ? t.receiver_name : t.sender_name;
            const pets = JSON.parse(t.sender_pets || '[]').length;
            
            text += `${isSender ? '📤' : '📥'} With ${other}\n`;
            text += `   ${Helpers.formatNumber(t.sender_points)} pts`;
            if (pets > 0) text += ` + ${pets} pet(s)`;
            text += `\n   ${new Date(t.completed_at).toLocaleDateString()}\n\n`;
        });
        
        await sock.sendMessage(jid, { text });
    }
    
    static async counterOffer(sock, phone, jid, tradeId, args) {
        // Advanced feature: Allow counter offers
        // Implementation would go here
        await sock.sendMessage(jid, { text: 'Counter offers coming soon!' });
    }
}

module.exports = TradeSystem;
