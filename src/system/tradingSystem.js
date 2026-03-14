
trading_system = """const moment = require('moment');

class TradingSystem {
    constructor(db) {
        this.db = db;
        this.activeTrades = new Map(); // tradeId -> trade data
    }

    async initiateTrade(fromPlayer, toPhone) {
        // Validate target
        const toPhoneClean = toPhone.replace(/[^0-9]/g, '');
        const toPlayer = await this.db.getPlayer(toPhoneClean);
        
        if (!toPlayer) {
            return { error: 'Player not found! Make sure they are registered.' };
        }
        
        if (toPhoneClean === fromPlayer.phone) {
            return { error: 'You cannot trade with yourself!' };
        }

        // Check if target is online
        if (toPlayer.status !== 'online') {
            return { error: `${toPlayer.name} is currently offline. They must be online to trade.` };
        }

        // Check for existing pending trades
        const existingTrades = await this.db.getPendingTrades(toPhoneClean);
        if (existingTrades.length >= 5) {
            return { error: 'Target has too many pending trade requests!' };
        }

        // Create trade
        const trade = await this.db.createTrade({
            from_phone: fromPlayer.phone,
            to_phone: toPhoneClean,
            offer_pet_id: null,
            offer_points: 0,
            request_pet_id: null,
            request_points: 0
        });

        this.activeTrades.set(trade.id, {
            ...trade,
            fromName: fromPlayer.name,
            toName: toPlayer.name,
            offerItems: [],
            requestItems: [],
            status: 'pending'
        });

        return {
            success: true,
            tradeId: trade.id,
            message: `📤 Trade request sent to ${toPlayer.name}!`,
            targetJid: `${toPhoneClean}@s.whatsapp.net`
        };
    }

    async addTradeItem(tradeId, phone, itemType, itemData) {
        const trade = this.activeTrades.get(tradeId) || await this.db.get('SELECT * FROM trades WHERE id = ?', [tradeId]);
        if (!trade) return { error: 'Trade not found!' };

        const isInitiator = trade.from_phone === phone;
        
        // Check if trade is still pending
        if (trade.status !== 'pending') {
            return { error: 'Trade is no longer active!' };
        }

        if (itemType === 'points') {
            const amount = parseInt(itemData);
            const player = await this.db.getPlayer(phone);
            
            if (player.points < amount) {
                return { error: 'Insufficient points!' };
            }

            if (isInitiator) {
                trade.offer_points = amount;
            } else {
                trade.request_points = amount;
            }
        } else if (itemType === 'pet') {
            const petId = parseInt(itemData);
            const pet = await this.db.get('SELECT * FROM pets WHERE id = ? AND owner_phone = ?', [petId, phone]);
            
            if (!pet) {
                return { error: 'Pet not found or not owned by you!' };
            }

            if (isInitiator) {
                trade.offer_pet_id = petId;
            } else {
                trade.request_pet_id = petId;
            }
        }

        this.activeTrades.set(tradeId, trade);
        
        return {
            success: true,
            message: `✅ Added ${itemType} to trade!`,
            trade: trade
        };
    }

    async acceptTrade(tradeId, phone) {
        const trade = this.activeTrades.get(tradeId);
        if (!trade) return { error: 'Trade not found!' };
        
        if (trade.to_phone !== phone) {
            return { error: 'You are not the recipient of this trade!' };
        }

        if (trade.status !== 'pending') {
            return { error: 'Trade already processed!' };
        }

        const fromPlayer = await this.db.getPlayer(trade.from_phone);
        const toPlayer = await this.db.getPlayer(trade.to_phone);

        // Validate both sides can fulfill the trade
        // Check points
        if (trade.offer_points > 0 && fromPlayer.points < trade.offer_points) {
            return { error: 'Initiator no longer has enough points!' };
        }
        if (trade.request_points > 0 && toPlayer.points < trade.request_points) {
            return { error: 'You do not have enough points!' };
        }

        // Check pets still exist
        if (trade.offer_pet_id) {
            const pet = await this.db.get('SELECT * FROM pets WHERE id = ? AND owner_phone = ?', 
                [trade.offer_pet_id, trade.from_phone]);
            if (!pet) return { error: 'Offered pet no longer available!' };
        }
        if (trade.request_pet_id) {
            const pet = await this.db.get('SELECT * FROM pets WHERE id = ? AND owner_phone = ?', 
                [trade.request_pet_id, trade.to_phone]);
            if (!pet) return { error: 'Requested pet no longer available!' };
        }

        // Execute trade - Points
        if (trade.offer_points > 0) {
            await this.db.updatePlayer(trade.from_phone, { 
                points: fromPlayer.points - trade.offer_points 
            });
            await this.db.updatePlayer(trade.to_phone, { 
                points: toPlayer.points + trade.offer_points 
            });
        }
        if (trade.request_points > 0) {
            await this.db.updatePlayer(trade.to_phone, { 
                points: toPlayer.points - trade.request_points 
            });
            await this.db.updatePlayer(trade.from_phone, { 
                points: fromPlayer.points + trade.request_points 
            });
        }

        // Execute trade - Pets
        if (trade.offer_pet_id) {
            await this.db.run('UPDATE pets SET owner_phone = ? WHERE id = ?', 
                [trade.to_phone, trade.offer_pet_id]);
        }
        if (trade.request_pet_id) {
            await this.db.run('UPDATE pets SET owner_phone = ? WHERE id = ?', 
                [trade.from_phone, trade.request_pet_id]);
        }

        // Update trade status
        await this.db.updateTradeStatus(tradeId, 'completed');
        trade.status = 'completed';
        this.activeTrades.delete(tradeId);

        return {
            success: true,
            message: `✅ Trade completed successfully!`,
            details: {
                received: {
                    points: trade.offer_points,
                    petId: trade.offer_pet_id
                },
                given: {
                    points: trade.request_points,
                    petId: trade.request_pet_id
                }
            }
        };
    }

    async declineTrade(tradeId, phone) {
        const trade = this.activeTrades.get(tradeId);
        if (!trade) return { error: 'Trade not found!' };
        
        if (trade.to_phone !== phone) {
            return { error: 'Not your trade!' };
        }

        await this.db.updateTradeStatus(tradeId, 'declined');
        this.activeTrades.delete(tradeId);

        return {
            success: true,
            message: '❌ Trade declined.'
        };
    }

    async cancelTrade(tradeId, phone) {
        const trade = this.activeTrades.get(tradeId);
        if (!trade) return { error: 'Trade not found!' };
        
        if (trade.from_phone !== phone) {
            return { error: 'Only the initiator can cancel!' };
        }

        await this.db.updateTradeStatus(tradeId, 'cancelled');
        this.activeTrades.delete(tradeId);

        return {
            success: true,
            message: '❌ Trade cancelled.'
        };
    }

    async getTradeStatus(tradeId) {
        const trade = this.activeTrades.get(tradeId) || 
            await this.db.get('SELECT * FROM trades WHERE id = ?', [tradeId]);
        
        if (!trade) return { error: 'Trade not found!' };

        const fromPlayer = await this.db.getPlayer(trade.from_phone);
        const toPlayer = await this.db.getPlayer(trade.to_phone);

        let text = `🤝 *Trade Request*\\n\\n`;
        text += `From: ${fromPlayer.name}\\n`;
        text += `To: ${toPlayer.name}\\n`;
        text += `Status: ${trade.status.toUpperCase()}\\n\\n`;
        
        text += `📤 *Offering:*\\n`;
        if (trade.offer_points > 0) text += `💰 ${trade.offer_points.toLocaleString()} points\\n`;
        if (trade.offer_pet_id) {
            const pet = await this.db.get('SELECT * FROM pets WHERE id = ?', [trade.offer_pet_id]);
            text += `🐾 ${pet ? pet.name : 'Unknown Pet'}\\n`;
        }
        if (!trade.offer_points && !trade.offer_pet_id) text += `Nothing yet\\n`;
        
        text += `\\n📥 *Requesting:*\\n`;
        if (trade.request_points > 0) text += `💰 ${trade.request_points.toLocaleString()} points\\n`;
        if (trade.request_pet_id) {
            const pet = await this.db.get('SELECT * FROM pets WHERE id = ?', [trade.request_pet_id]);
            text += `🐾 ${pet ? pet.name : 'Unknown Pet'}\\n`;
        }
        if (!trade.request_points && !trade.request_pet_id) text += `Nothing yet\\n`;

        return { trade, message: text };
    }

    async getPendingTrades(phone) {
        const trades = await this.db.getPendingTrades(phone);
        return trades;
    }

    formatTradeNotification(trade, fromPlayer) {
        let text = `🤝 *New Trade Request!*\\n\\n`;
        text += `${fromPlayer.name} wants to trade!\\n\\n`;
        
        if (trade.offer_points > 0 || trade.offer_pet_id) {
            text += `They offer:\\n`;
            if (trade.offer_points > 0) text += `💰 ${trade.offer_points.toLocaleString()} points\\n`;
            if (trade.offer_pet_id) text += `🐾 A pet\\n`;
        }
        
        text += `\\nReply with:\\n`;
        text += `/accept ${trade.id} - Accept trade\\n`;
        text += `/decline ${trade.id} - Decline trade\\n`;
        text += `/tradeinfo ${trade.id} - View details`;
        
        return text;
    }
}

module.exports = TradingSystem;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/systems/tradingSystem.js', 'w') as f:
    f.write(trading_system)

print("✅ 11. src/systems/tradingSystem.js created")