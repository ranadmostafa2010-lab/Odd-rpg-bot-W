const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class PvpSystem {
    static activeBattles = new Map(); // In-memory battle storage for real-time combat
    
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
        
        // Check if player already has pending match
        const existingPending = db.prepare(`
            SELECT * FROM pvp_matches 
            WHERE challenger_phone = ? AND status = 'pending'
        `).get(phone);
        
        if (existingPending) {
            return sock.sendMessage(jid, { 
                text: `🔍 You already have a pending match (ID: ${existingPending.id})\nWaiting for opponent...` 
            });
        }
        
        // Check if player is already in active battle
        const existingBattle = db.prepare(`
            SELECT * FROM pvp_matches 
            WHERE (challenger_phone = ? OR opponent_phone = ?) AND status = 'active'
        `).get(phone, phone);
        
        if (existingBattle) {
            return sock.sendMessage(jid, { 
                text: `⚔️ You are already in a battle!\nUse /rank to check status.` 
            });
        }
        
        // Look for pending match in ELO range (±200)
        const eloRange = 200;
        const pending = db.prepare(`
            SELECT m.*, p.elo as challenger_elo, p.name as challenger_name
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
            
            const challenger = {
                phone: pending.challenger_phone,
                name: pending.challenger_name,
                elo: pending.challenger_elo
            };
            
            // Notify both players
            await sock.sendMessage(jid, { 
                text: `⚔️ *Match Found!*\n\nOpponent: ${challenger.name}\nRank: ${Helpers.getRank(challenger.elo).icon} ${Helpers.getRank(challenger.elo).name} (${challenger.elo} ELO)\nLevel: ${player.level}\n\nBattle starting in 3 seconds...` 
            });
            
            await sock.sendMessage(Helpers.getJid(challenger.phone), {
                text: `⚔️ *Opponent Found!*\n\n${player.name} has joined!\nRank: ${Helpers.getRank(player.elo).icon} ${Helpers.getRank(player.elo).name} (${player.elo} ELO)\nLevel: ${player.level}\n\nBattle starting in 3 seconds...`
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
                text: `🔍 *Searching for opponent...*\n\nYour ELO: ${player.elo} (${Helpers.getRank(player.elo).icon} ${player.rank})\nSearch Range: ±${eloRange} ELO\nMatch ID: ${result.lastInsertRowid}\n\nWaiting for match... This may take a few minutes.\n\nUse /ranked again to cancel search.` 
            });
        }
    }
    
    static async initializeBattle(sock, matchId) {
        const db = Database.get();
        const match = db.prepare('SELECT * FROM pvp_matches WHERE id = ?').get(matchId);
        
        if (!match || match.status !== 'active') return;
        
        const p1 = GameEngine.getPlayer(match.challenger_phone);
        const p2 = GameEngine.getPlayer(match.opponent_phone);
        
        if (!p1 || !p2) {
            // Cancel match if player not found
            db.prepare("UPDATE pvp_matches SET status = 'cancelled' WHERE id = ?").run(matchId);
            return;
        }
        
        // Set initial HP with pet bonuses
        const p1Pet = GameEngine.getEquippedPet(p1.phone);
        const p2Pet = GameEngine.getEquippedPet(p2.phone);
        
        const p1MaxHp = p1.max_hp + (p1Pet?.hp_bonus || 0);
        const p2MaxHp = p2.max_hp + (p2Pet?.hp_bonus || 0);
        
        db.prepare('UPDATE pvp_matches SET challenger_hp = ?, opponent_hp = ? WHERE id = ?')
            .run(p1MaxHp, p2MaxHp, matchId);
        
        // Store battle data in memory for real-time combat
        this.activeBattles.set(matchId, {
            p1: { ...p1, hp: p1MaxHp, maxHp: p1MaxHp, pet: p1Pet, ready: false },
            p2: { ...p2, hp: p2MaxHp, maxHp: p2MaxHp, pet: p2Pet, ready: false },
            turn: 1,
            currentPlayer: 1, // 1 = p1, 2 = p2
            status: 'waiting',
            lastAction: Date.now(),
            log: []
        });
        
        const text = `⚔️ *PvP BATTLE STARTED!*\n\n` +
            `👤 ${p1.name} (${Helpers.getRank(p1.elo).icon} ${p1.rank})\n` +
            `   ❤️ ${p1MaxHp} HP | ⚔️ ${p1.attack + (p1Pet?.attack_bonus || 0)} ATK | 🛡️ ${p1.defense + (p1Pet?.defense_bonus || 0)} DEF\n\n` +
            `👤 ${p2.name} (${Helpers.getRank(p2.elo).icon} ${p2.rank})\n` +
            `   ❤️ ${p2MaxHp} HP | ⚔️ ${p2.attack + (p2Pet?.attack_bonus || 0)} ATK | 🛡️ ${p2.defense + (p2Pet?.defense_bonus || 0)} DEF\n\n` +
            `*How to play:*\n` +
            `1. Use /attack to strike\n` +
            `2. Use /defend to block (reduces damage by 70%)\n` +
            `3. Use /special for pet ultimate (once per battle)\n` +
            `4. First to 0 HP loses!\n\n` +
            `_Waiting for both players to be ready..._`;
            
        await sock.sendMessage(Helpers.getJid(p1.phone), { text });
        await sock.sendMessage(Helpers.getJid(p2.phone), { text });
        
        // Set timeout for battle start
        setTimeout(() => {
            const battle = this.activeBattles.get(matchId);
            if (battle && battle.status === 'waiting') {
                this.startCombat(sock, matchId);
            }
        }, 5000);
    }
    
    static async startCombat(sock, matchId) {
        const battle = this.activeBattles.get(matchId);
        if (!battle) return;
        
        battle.status = 'active';
        
        const p1Name = battle.p1.name;
        const p2Name = battle.p2.name;
        
                const text = `⚔️ *BATTLE BEGINS!*\n\n` +
            `🔴 ${p1Name} VS ${p2Name} 🔵\n\n` +
            `It's ${p1Name}'s turn!\n` +
            `Use /attack, /defend, or /special`;
            
        await sock.sendMessage(Helpers.getJid(battle.p1.phone), { text });
        await sock.sendMessage(Helpers.getJid(battle.p2.phone), { 
            text: `⚔️ *BATTLE BEGINS!*\n\n🔴 ${p1Name} VS ${p2Name} 🔵\n\nWaiting for ${p1Name} to move...` 
        });
    }
    
    static async processAction(sock, matchId, phone, action) {
        const battle = this.activeBattles.get(matchId);
        if (!battle || battle.status !== 'active') return;
        
        const isP1 = battle.p1.phone === phone;
        const isP2 = battle.p2.phone === phone;
        
        if (!isP1 && !isP2) return;
        
        const currentPlayer = battle.currentPlayer === 1 ? battle.p1 : battle.p2;
        const otherPlayer = battle.currentPlayer === 1 ? battle.p2 : battle.p1;
        
        // Check if it's this player's turn
        if ((battle.currentPlayer === 1 && !isP1) || (battle.currentPlayer === 2 && !isP2)) {
            return sock.sendMessage(Helpers.getJid(phone), { 
                text: '⏳ Wait for your opponent to move!' 
            });
        }
        
        let damage = 0;
        let isCrit = false;
        let defenseBoost = false;
        let specialUsed = false;
        
        switch(action) {
            case 'attack':
                isCrit = Helpers.isCrit();
                const attackPower = currentPlayer.attack + (currentPlayer.pet?.attack_bonus || 0);
                const defense = otherPlayer.defense + (otherPlayer.pet?.defense_bonus || 0);
                damage = Helpers.calculateDamage(
                    { attack: attackPower },
                    { defense: defense },
                    isCrit
                );
                break;
                
            case 'defend':
                defenseBoost = true;
                damage = 0;
                break;
                
            case 'special':
                if (currentPlayer.specialUsed) {
                    return sock.sendMessage(Helpers.getJid(phone), { 
                        text: '❌ Special attack already used!' 
                    });
                }
                specialUsed = true;
                isCrit = true;
                const specialPower = (currentPlayer.attack + (currentPlayer.pet?.attack_bonus || 0)) * 
                    global.gameConfig.combat.specialMultiplier;
                const specialDefense = otherPlayer.defense + (otherPlayer.pet?.defense_bonus || 0);
                damage = Helpers.calculateDamage(
                    { attack: specialPower },
                    { defense: specialDefense },
                    true
                );
                currentPlayer.specialUsed = true;
                break;
                
            default:
                return;
        }
        
        // Apply damage to opponent
        if (damage > 0) {
            otherPlayer.hp = Math.max(0, otherPlayer.hp - damage);
        }
        
        // Log action
        battle.log.push({
            turn: battle.turn,
            player: currentPlayer.name,
            action,
            damage,
            isCrit,
            targetHp: otherPlayer.hp
        });
        
        // Check for winner
        if (otherPlayer.hp <= 0) {
            await this.endBattle(sock, matchId, currentPlayer.phone);
            return;
        }
        
        // If defender used defend, they get reduced damage next turn
        if (defenseBoost) {
            currentPlayer.defending = true;
        } else {
            currentPlayer.defending = false;
        }
        
        // Switch turns
        battle.currentPlayer = battle.currentPlayer === 1 ? 2 : 1;
        battle.turn++;
        battle.lastAction = Date.now();
        
        // Send turn results
        const nextPlayer = battle.currentPlayer === 1 ? battle.p1 : battle.p2;
        const prevPlayer = battle.currentPlayer === 1 ? battle.p2 : battle.p1;
        
        let resultText = `⚔️ *Turn ${battle.turn - 1} Results*\n\n`;
        
        if (action === 'defend') {
            resultText += `🛡️ ${currentPlayer.name} takes defensive stance!\n`;
            resultText += `Damage reduced for next attack!\n`;
        } else if (action === 'special') {
            resultText += `✨ ${currentPlayer.name} uses SPECIAL ATTACK!\n`;
            resultText += `${isCrit ? '💥 CRITICAL! ' : ''}Deals ${damage} damage!\n`;
        } else {
            resultText += `⚔️ ${currentPlayer.name} ${isCrit ? '💥 CRIT ' : ''}hits for ${damage} damage!\n`;
        }
        
        resultText += `\n❤️ ${otherPlayer.name}: ${Helpers.hpBar(otherPlayer.hp, otherPlayer.maxHp)} ${otherPlayer.hp}/${otherPlayer.maxHp}\n`;
        resultText += `❤️ ${currentPlayer.name}: ${Helpers.hpBar(currentPlayer.hp, currentPlayer.maxHp)} ${currentPlayer.hp}/${currentPlayer.maxHp}\n\n`;
        
        if (battle.currentPlayer === 1) {
            resultText += `🔴 It's ${nextPlayer.name}'s turn!\n/attack /defend /special`;
            await sock.sendMessage(Helpers.getJid(battle.p1.phone), { text: resultText });
            await sock.sendMessage(Helpers.getJid(battle.p2.phone), { 
                text: resultText.replace(`🔴 It's ${nextPlayer.name}'s turn!`, `⏳ Waiting for ${nextPlayer.name}...`) 
            });
        } else {
            resultText += `🔵 It's ${nextPlayer.name}'s turn!\n/attack /defend /special`;
            await sock.sendMessage(Helpers.getJid(battle.p2.phone), { text: resultText });
            await sock.sendMessage(Helpers.getJid(battle.p1.phone), { 
                text: resultText.replace(`🔵 It's ${nextPlayer.name}'s turn!`, `⏳ Waiting for ${nextPlayer.name}...`) 
            });
        }
        
        // Set turn timeout
        this.setTurnTimeout(sock, matchId);
    }
    
    static setTurnTimeout(sock, matchId) {
        // Clear existing timeout if any
        const battle = this.activeBattles.get(matchId);
        if (battle.timeout) clearTimeout(battle.timeout);
        
        // Set new timeout (60 seconds per turn)
        battle.timeout = setTimeout(() => {
            this.handleTurnTimeout(sock, matchId);
        }, 60000);
    }
    
    static async handleTurnTimeout(sock, matchId) {
        const battle = this.activeBattles.get(matchId);
        if (!battle || battle.status !== 'active') return;
        
        const currentPlayer = battle.currentPlayer === 1 ? battle.p1 : battle.p2;
        const otherPlayer = battle.currentPlayer === 1 ? battle.p2 : battle.p1;
        
        // Auto-forfeit current player
        await sock.sendMessage(Helpers.getJid(currentPlayer.phone), { 
            text: '⏰ Turn timed out! You forfeit the match.' 
        });
        
        await sock.sendMessage(Helpers.getJid(otherPlayer.phone), { 
            text: `⏰ ${currentPlayer.name} timed out. You win by forfeit!` 
        });
        
        await this.endBattle(sock, matchId, otherPlayer.phone, true);
    }
    
    static async attack(sock, phone, jid) {
        const db = Database.get();
        const match = db.prepare(`
            SELECT * FROM pvp_matches 
            WHERE (challenger_phone = ? OR opponent_phone = ?) AND status = 'active'
        `).get(phone, phone);
        
        if (!match) {
            return sock.sendMessage(jid, { text: '❌ No active PvP battle. Use /ranked to find a match.' });
        }
        
        await this.processAction(sock, match.id, phone, 'attack');
    }
    
    static async defend(sock, phone, jid) {
        const db = Database.get();
        const match = db.prepare(`
            SELECT * FROM pvp_matches 
            WHERE (challenger_phone = ? OR opponent_phone = ?) AND status = 'active'
        `).get(phone, phone);
        
        if (!match) {
            return sock.sendMessage(jid, { text: '❌ No active PvP battle.' });
        }
        
        await this.processAction(sock, match.id, phone, 'defend');
    }
    
    static async special(sock, phone, jid) {
        const db = Database.get();
        const match = db.prepare(`
            SELECT * FROM pvp_matches 
            WHERE (challenger_phone = ? OR opponent_phone = ?) AND status = 'active'
        `).get(phone, phone);
        
        if (!match) {
            return sock.sendMessage(jid, { text: '❌ No active PvP battle.' });
        }
        
        await this.processAction(sock, match.id, phone, 'special');
    }
    
    static async endBattle(sock, matchId, winnerPhone, forfeit = false) {
        const db = Database.get();
        const battle = this.activeBattles.get(matchId);
        
        if (battle?.timeout) clearTimeout(battle.timeout);
        
        const match = db.prepare('SELECT * FROM pvp_matches WHERE id = ?').get(matchId);
        if (!match) return;
        
        const p1 = GameEngine.getPlayer(match.challenger_phone);
        const p2 = GameEngine.getPlayer(match.opponent_phone);
        
        if (!p1 || !p2) return;
        
        const winner = winnerPhone === p1.phone ? p1 : p2;
        const loser = winnerPhone === p1.phone ? p2 : p1;
        
        // Calculate ELO changes
        const config = global.gameConfig;
        const eloDiff = loser.elo - winner.elo;
        const expectedScore = 1 / (1 + Math.pow(10, eloDiff / 400));
        const kFactor = 32;
        
        let eloChange = Math.round(kFactor * (1 - expectedScore));
        
        // Minimum ELO change
        if (eloChange < 1) eloChange = 1;
        
        // Streak bonus
        if (winner.pvp_streak >= 3) {
            eloChange += config.pvp.streakBonus;
        }
        
        // Forfeit penalty
        if (forfeit && loser.phone === winnerPhone) {
            eloChange = Math.floor(eloChange * 0.5); // Reduced gains for forfeit win
        }
        
        // Update players
        const newWinnerElo = winner.elo + eloChange;
        const newLoserElo = Math.max(0, loser.elo - eloChange);
        
        GameEngine.updatePlayer(winner.phone, {
            elo: newWinnerElo,
            wins: winner.wins + 1,
            pvp_streak: winner.pvp_streak + 1,
            last_pvp: new Date().toISOString()
        });
        
        GameEngine.updatePlayer(loser.phone, {
            elo: newLoserElo,
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
        
        // Calculate rewards
        const baseReward = 100;
        const eloBonus = Math.floor(eloChange * 10);
        const totalReward = baseReward + eloBonus;
        
        GameEngine.addPoints(winner.phone, totalReward);
        
        // Update ranks if changed
        const newWinnerRank = Helpers.getRank(newWinnerElo);
        const newLoserRank = Helpers.getRank(newLoserElo);
        
        if (newWinnerRank.name !== winner.rank) {
            GameEngine.updatePlayer(winner.phone, { rank: newWinnerRank.name });
        }
        if (newLoserRank.name !== loser.rank) {
            GameEngine.updatePlayer(loser.phone, { rank: newLoserRank.name });
        }
        
        // Build result messages
        const winText = `🎉 *VICTORY!* ${forfeit ? '(By Forfeit)' : ''}\n\n` +
            `You defeated ${loser.name}!\n\n` +
            `📊 *Results:*\n` +
            `ELO: ${winner.elo} → ${newWinnerElo} (+${eloChange})\n` +
            `Rank: ${Helpers.getRank(winner.elo).icon} ${winner.rank} → ${newWinnerRank.icon} ${newWinnerRank.name}\n` +
            `Streak: ${winner.pvp_streak + 1} wins 🔥\n\n` +
            `💰 Rewards:\n` +
            `• ${Helpers.formatNumber(totalReward)} points\n` +
            `• ${Helpers.formatNumber(eloBonus)} bonus (ELO gain)\n\n` +
            `Great job! Play again: /ranked`;
            
        const loseText = `💔 *DEFEAT* ${forfeit ? '(Time Forfeit)' : ''}\n\n` +
            `You lost to ${winner.name}\n\n` +
            `📊 *Results:*\n` +
            `ELO: ${loser.elo} → ${newLoserElo} (-${eloChange})\n` +
            `Rank: ${Helpers.getRank(loser.elo).icon} ${loser.rank}`;
        if (newLoserRank.name !== loser.rank) {
            loseText += ` → ${newLoserRank.icon} ${newLoserRank.name}`;
        }
        loseText += `\nStreak reset 😢\n\n` +
            `Don't give up! Try again: /ranked`;
        
        // Send messages
        await sock.sendMessage(Helpers.getJid(winner.phone), { text: winText });
        await sock.sendMessage(Helpers.getJid(loser.phone), { text: loseText });
        
        // Clean up
        this.activeBattles.delete(matchId);
        
        // Log
        GameEngine.logAction('pvp_match_end', winner.phone, { 
            opponent: loser.phone, 
            winner: true, 
            eloChange,
            forfeit 
        });
        GameEngine.logAction('pvp_match_end', loser.phone, { 
            opponent: winner.phone, 
            winner: false, 
            eloChange: -eloChange,
            forfeit 
        });
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
        
        // Get recent form (last 5 matches)
        const recent = db.prepare(`
            SELECT winner_phone FROM pvp_matches 
            WHERE (challenger_phone = ? OR opponent_phone = ?) 
            AND status = 'completed'
            ORDER BY ended_at DESC
            LIMIT 5
        `).all(phone, phone);
        
        const form = recent.map(m => m.winner_phone === phone ? 'W' : 'L').join(' ');
        
        let text = `🏆 *Your PvP Stats*\n\n`;
        text += `Rank: ${rank.icon} ${rank.name}\n`;
        text += `ELO: ${Helpers.formatNumber(player.elo)}`;
        if (nextRank) {
            const needed = nextRank.min - player.elo;
            text += ` (${needed} to ${nextRank.name})`;
        }
        text += `\n`;
        text += `Global: #${Helpers.formatNumber(position)} of ${Helpers.formatNumber(totalPlayers)}\n`;
        text += `Percentile: Top ${((position / totalPlayers) * 100).toFixed(1)}%\n\n`;
        
        text += `*Record:*\n`;
        text += `${player.wins}W - ${player.losses}L`;
        if (player.draws) text += ` - ${player.draws}D`;
        const totalGames = player.wins + player.losses + (player.draws || 0);
        if (totalGames > 0) {
            const winRate = ((player.wins / totalGames) * 100).toFixed(1);
            text += ` (${winRate}% WR)`;
        }
        text += `\n`;
        
        if (recent.length > 0) {
            text += `Form (last 5): ${form || 'None yet'}\n`;
        }
        
        if (player.pvp_streak > 0) {
            text += `🔥 Win Streak: ${player.pvp_streak}\n`;
            if (player.pvp_streak >= 3) {
                text += `   (+${config.pvp.streakBonus} ELO bonus active!)\n`;
            }
        }
        
        text += `\n*Next Match:*\n`;
        if (player.last_pvp) {
            const minutesSince = (Date.now() - new Date(player.last_pvp)) / (1000 * 60);
            const cooldown = config.cooldowns.pvp;
            if (minutesSince < cooldown) {
                const minsLeft = Math.ceil(cooldown - minutesSince);
                text += `Cooldown: ${minsLeft} minutes\n`;
            } else {
                text += `✅ Ready! Use /ranked\n`;
            }
        } else {
            text += `✅ Ready! Use /ranked\n`;
        }
        
        await sock.sendMessage(jid, { text });
    }
    
    static async acceptMatch(sock, phone, jid, matchId) {
        // For manual acceptance if needed
        await sock.sendMessage(jid, { text: 'Match auto-accepts when found. Use /ranked to search!' });
    }
    
    static async declineMatch(sock, phone, jid, matchId) {
        const db = Database.get();
        
        // Cancel pending match if player is challenger
        const pending = db.prepare(`
            SELECT * FROM pvp_matches 
            WHERE challenger_phone = ? AND status = 'pending'
        `).get(phone);
        
        if (pending) {
            db.prepare("UPDATE pvp_matches SET status = 'cancelled' WHERE id = ?").run(pending.id);
            return sock.sendMessage(jid, { text: '✅ Search cancelled.' });
        }
        
        // Decline active match invitation
        if (matchId) {
            const match = db.prepare('SELECT * FROM pvp_matches WHERE id = ? AND opponent_phone = ? AND status = ?')
                .get(matchId, phone, 'pending');
            
            if (match) {
                db.prepare("UPDATE pvp_matches SET status = 'declined' WHERE id = ?").run(matchId);
                
                // Notify challenger
                await sock.sendMessage(Helpers.getJid(match.challenger_phone), {
                    text: `❌ ${GameEngine.getPlayer(phone)?.name || 'Opponent'} declined your match request.`
                });
                
                return sock.sendMessage(jid, { text: '✅ Match declined.' });
            }
        }
        
        await sock.sendMessage(jid, { text: 'No pending match to decline.' });
    }
    
    static async showHistory(sock, phone, jid) {
        const db = Database.get();
        const matches = db.prepare(`
            SELECT m.*, 
                p1.name as challenger_name,
                p2.name as opponent_name
            FROM pvp_matches m
            JOIN players p1 ON m.challenger_phone = p1.phone
            JOIN players p2 ON m.opponent_phone = p2.phone
            WHERE (m.challenger_phone = ? OR m.opponent_phone = ?) 
            AND m.status = 'completed'
            ORDER BY m.ended_at DESC
            LIMIT 10
        `).all(phone, phone);
        
        if (matches.length === 0) {
            return sock.sendMessage(jid, { text: '📭 No PvP history yet. Use /ranked to fight!' });
        }
        
        let text = `⚔️ *Recent PvP Matches*\n\n`;
        
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            const isChallenger = m.challenger_phone === phone;
            const opponent = isChallenger ? m.opponent_name : m.challenger_name;
            const won = m.winner_phone === phone;
            const myHp = isChallenger ? m.challenger_hp : m.opponent_hp;
            
            text += `${i + 1}. ${won ? '✅' : '❌'} vs ${opponent}\n`;
            text += `   ${won ? 'Won' : 'Lost'} - ${myHp} HP remaining\n`;
            text += `   ${new Date(m.ended_at).toLocaleDateString()}\n\n`;
        }
        
        text += `View full stats: /rank`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async cancelSearch(sock, phone, jid) {
        const db = Database.get();
        const pending = db.prepare(`
            SELECT * FROM pvp_matches 
            WHERE challenger_phone = ? AND status = 'pending'
        `).get(phone);
        
        if (!pending) {
            return sock.sendMessage(jid, { text: 'No active search to cancel.' });
        }
        
        db.prepare("UPDATE pvp_matches SET status = 'cancelled' WHERE id = ?").run(pending.id);
        await sock.sendMessage(jid, { text: '✅ Search cancelled.' });
    }
}

module.exports = PvpSystem;
