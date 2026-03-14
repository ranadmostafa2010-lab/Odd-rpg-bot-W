const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class PvpSystem {
    static async findMatch(sock, phone, jid) {
        const config = global.gameConfig;
        const db = Database.get();
        const player = GameEngine.getPlayer(phone);
        
        // Check cooldown
        if (player.last_pvp) {
            const minutesSince = (Date.now() - new Date(player.last_pvp)) / (1000 * 60);
            if (minutesSince < config.cooldowns.pvp) {
                const minsLeft = Math.ceil(config.cooldowns.pvp - minutesSince);
                return sock.sendMessage(jid, { 
                    text: `⏰ PvP cooldown: ${minsLeft} minutes remaining\nUse /rank to see your stats.` 
                });
            }
        }
        
        // Look for pending match in ELO range (±200)
        const eloRange = 200;
        const pending = db.prepare(`
            SELECT m.*, p.elo as challenger_elo 
            FROM pvp_matches m
            JOIN players p ON m.challenger_phone = p.phone
            WHERE m.status = 'pending' 
            AND m.challenger_phone != ?
            AND p.elo BETWEEN ? AND ?
            LIMIT 1
        `).get(phone, player.elo - eloRange, player.elo + eloRange);
        
        if (pending) {
            // Join existing match
            db.prepare(`
                UPDATE pvp_matches 
                SET opponent_phone = ?, status = 'active', started_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(phone, pending.id);
            
            const challenger = GameEngine.getPlayer(pending.challenger_phone);
            
            // Notify both players
            await sock.sendMessage(jid, { 
                text: `⚔️ *Match Found!*\n\nOpponent: ${challenger.name}\nRank: ${challenger.rank} (${challenger.elo} ELO)\nLevel: ${challenger.level}\n\nBattle starting in 3 seconds...` 
            });
            
            await sock.sendMessage(Helpers.getJid(pending.challenger_phone), {
                text: `⚔️ *Opponent Found!*\n\n${player.name} has joined!\nRank: ${player.rank} (${player.elo} ELO)\nLevel: ${player.level}\n\nBattle starting in 3 seconds...`
            });
            
            // Initialize battle after delay
            setTimeout(() => this.initializeBattle(sock, pending.id), 3000);
        } else {
            // Create new pending match
            const result = db.prepare(`
                INSERT INTO pvp_matches (challenger_phone, challenger_hp, status)
                VALUES (?, ?, 'pending')
            `).run(phone, player.max_hp);
            
            await sock.sendMessage(jid, { 
                text: `🔍 *Searching for opponent...*\n\nYour ELO: ${player.elo} (${player.rank})\nRange: ±${eloRange}\n\nMatch ID: ${result.lastInsertRowid}\n\nWaiting for match... Use /ranked again to cancel.` 
            });
        }
    }
    
    static async initializeBattle(sock, matchId) {
        const db = Database.get();
        const match = db.prepare('SELECT * FROM pvp_matches WHERE id = ?').get(matchId);
        
        const p1 = GameEngine.getPlayer(match.challenger_phone);
        const p2 = GameEngine.getPlayer(match.opponent_phone);
        
        // Set initial HP
        db.prepare('UPDATE pvp_matches SET challenger_hp = ?, opponent_hp = ? WHERE id = ?')
            .run(p1.max_hp, p2.max_hp, matchId);
        
        const text = `⚔️ *PvP BATTLE STARTED!*\n\n` +
            `${p1.name} (${p1.rank}) vs ${p2.name} (${p2.rank})\n` +
            `ELO: ${p1.elo} vs ${p2.elo}\n\n` +
            `❤️ ${p1.name}: ${p1.max_hp} HP\n` +
            `❤️ ${p2.name}: ${p2.max_hp} HP\n\n` +
            `Both players must use /attack to begin!`;
            
        await sock.sendMessage(Helpers.getJid(p1.phone), { text });
        await sock.sendMessage(Helpers.getJid(p2.phone), { text });
    }
    
    static async processRound(sock, matchId) {
        const db = Database.get();
        const match = db.prepare('SELECT * FROM pvp_matches WHERE id = ?').get(matchId);
        
        if (!match || match.status !== 'active') return;
        
        const p1 = GameEngine.getPlayer(match.challenger_phone);
        const p2 = GameEngine.getPlayer(match.opponent_phone);
        
        // Simple auto-battle for now (can be enhanced with player choices)
        const p1Pet = GameEngine.getEquippedPet(p1.phone);
        const p2Pet = GameEngine.getEquippedPet(p2.phone);
        
        // P1 attacks P2
        const p1Atk = p1.attack + (p1Pet?.attack_bonus || 0);
        const p2Def = p2.defense + (p2Pet?.defense_bonus || 0);
        const p1Crit = Helpers.isCrit();
        const dmg1 = Helpers.calculateDamage({ attack: p1Atk }, { defense: p2Def }, p1Crit);
        
        // P2 attacks P1
        const p2Atk = p2.attack + (p2Pet?.attack_bonus || 0);
        const p1Def = p1.defense + (p1Pet?.defense_bonus || 0);
        const p2Crit = Helpers.isCrit();
        const dmg2 = Helpers.calculateDamage({ attack: p2Atk }, { defense: p1Def }, p2Crit);
        
        const newP2Hp = Math.max(0, match.opponent_hp - dmg1);
        const newP1Hp = Math.max(0, match.challenger_hp - dmg2);
        
        db.prepare(`
            UPDATE pvp_matches 
            SET challenger_hp = ?, opponent_hp = ?, turns = turns + 1 
            WHERE id = ?
        `).run(newP1Hp, newP2Hp, matchId);
        
        // Check for winner
        if (newP1Hp <= 0 || newP2Hp <= 0) {
            await this.endBattle(sock, matchId, newP1Hp > 0 ? p1.phone : p2.phone);
            return;
        }
        
        // Continue battle
        const text = `⚔️ *Round ${match.turns + 1}*\n\n` +
            `${p1.name} ${p1Crit ? '💥 CRIT ' : ''}deals ${dmg1} damage!\n` +
            `${p2.name} ${p2Crit ? '💥 CRIT ' : ''}deals ${dmg2} damage!\n\n` +
            `❤️ ${p1.name}: ${Helpers.hpBar(newP1Hp, p1.max_hp)} ${newP1Hp}/${p1.max_hp}\n` +
            `❤️ ${p2.name}: ${Helpers.hpBar(newP2Hp, p2.max_hp)} ${newP2Hp}/${p2.max_hp}`;
            
        await sock.sendMessage(Helpers.getJid(p1.phone), { text });
        await sock.sendMessage(Helpers.getJid(p2.phone), { text });
        
        // Schedule next round
        setTimeout(() => this.processRound(sock, matchId), 5000);
    }
    
    static async endBattle(sock, matchId, winnerPhone) {
        const db = Database.get();
        const match = db.prepare('SELECT * FROM pvp_matches WHERE id = ?').get(matchId);
        
        const p1 = GameEngine.getPlayer(match.challenger_phone);
        const p2 = GameEngine.getPlayer(match.opponent_phone);
        const loserPhone = winnerPhone === p1.phone ? p2.phone : p1.phone;
        const winner = winnerPhone === p1.phone ? p1 : p2;
        const loser = winnerPhone === p1.phone ? p2 : p1;
        
        // Calculate ELO changes
        const config = global.gameConfig;
        const eloDiff = loser.elo - winner.elo;
        const expectedScore = 1 / (1 + Math.pow(10, eloDiff / 400));
        const kFactor = 32;
        
        let eloChange = Math.round(kFactor * (1 - expectedScore));
        
        // Streak bonus
        if (winner.pvp_streak >= 3) {
            eloChange += config.pvp.streakBonus;
        }
        
        // Update players
        GameEngine.updatePlayer(winnerPhone, {
            elo: winner.elo + eloChange,
            wins: winner.wins + 1,
            pvp_streak: winner.pvp_streak + 1,
            last_pvp: new Date().toISOString()
        });
        
        GameEngine.updatePlayer(loserPhone, {
            elo: Math.max(0, loser.elo - eloChange),
            losses: loser.losses + 1,
            pvp_streak: 0,
            last_pvp: new Date().toISOString()
        });
        
        // Update match
        db.prepare(`
            UPDATE pvp_matches 
            SET status = 'completed', winner_phone = ?, ended_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(winnerPhone, matchId);
        
        // Rewards
        const rewardPoints = 100 + (eloChange * 10);
        GameEngine.addPoints(winnerPhone, rewardPoints);
        
        // Notify
        const winText = `🎉 *VICTORY!*\n\n` +
            `You defeated ${loser.name}!\n` +
            `ELO: +${eloChange} (${winner.elo} → ${winner.elo + eloChange})\n` +
            `💰 +${Helpers.formatNumber(rewardPoints)} points\n` +
            `Streak: ${winner.pvp_streak + 1}`;
            
        const loseText = `💔 *DEFEAT*\n\n` +
            `You lost to ${winner.name}\n` +
            `ELO: -${eloChange} (${loser.elo} → ${loser.elo - eloChange})\n` +
            `Don't give up! Try again with /ranked`;
            
        await sock.sendMessage(Helpers.getJid(winnerPhone), { text: winText });
        await sock.sendMessage(Helpers.getJid(loserPhone), { text: loseText });
    }
    
    static async showRank(sock, phone, jid) {
        const player = GameEngine.getPlayer(phone);
        const config = global.gameConfig;
        const rank = Helpers.getRank(player.elo);
        const nextRank = Helpers.getNextRank(player.elo);
        
        const db = Database.get();
        const position = db.prepare(`
            SELECT COUNT(*) as pos FROM players 
            WHERE elo > ? AND banned = 0
        `).get(player.elo).pos + 1;
        
        const totalPlayers = db.prepare('SELECT COUNT(*) as count FROM players WHERE banned = 0').get().count;
        
        let text = `🏆 *Your PvP Stats*\n\n`;
        text += `Rank: ${rank.icon} ${rank.name}\n`;
        text += `ELO: ${player.elo}`;
        if (nextRank) {
            const needed = nextRank.min - player.elo;
            text += ` (${needed} to ${nextRank.name})`;
        }
        text += `\n`;
        text += `Global Position: #${position} of ${totalPlayers}\n`;
        text += `Record: ${player.wins}W - ${player.losses}L`;
        if (player.wins + player.losses > 0) {
            text += ` (${Math.round((player.wins / (player.wins + player.losses)) * 100)}% WR)`;
        }
        text += `\n`;
        if (player.pvp_streak > 0) {
            text += `🔥 Win Streak: ${player.pvp_streak}\n`;
        }
        text += `\nUse /ranked to find a match!`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async acceptMatch(sock, phone, jid, matchId) {
        // Implementation for manual match acceptance if needed
        await sock.sendMessage(jid, { text: 'Match accepted! Waiting for opponent...' });
    }
    
    static async declineMatch(sock, phone, jid, matchId) {
        const db = Database.get();
        db.prepare("UPDATE pvp_matches SET status = 'declined' WHERE id = ?").run(matchId);
        await sock.sendMessage(jid, { text: 'Match declined.' });
    }
    
    static async showHistory(sock, phone, jid) {
        const db = Database.get();
        const matches = db.prepare(`
            SELECT * FROM pvp_matches 
            WHERE (challenger_phone = ? OR opponent_phone = ?) 
            AND status = 'completed'
            ORDER BY ended_at DESC
            LIMIT 5
        `).all(phone, phone);
        
        if (matches.length === 0) {
            return sock.sendMessage(jid, { text: 'No PvP history yet. Use /ranked to fight!' });
        }
        
        let text = `⚔️ *Recent PvP Matches*\n\n`;
        
        for (const match of matches) {
            const isChallenger = match.challenger_phone === phone;
            const opponent = isChallenger ? match.opponent_phone : match.challenger_phone;
            const opponentData = GameEngine.getPlayer(opponent);
            const won = match.winner_phone === phone;
            
            text += `${won ? '✅' : '❌'} vs ${opponentData?.name || opponent}\n`;
            text += `   ${won ? 'Won' : 'Lost'} - ELO: ${isChallenger ? match.challenger_hp : match.opponent_hp} HP left\n`;
        }
        
        await sock.sendMessage(jid, { text });
    }
}

module.exports = PvpSystem;
