
pvp_system = """const moment = require('moment');

class PvPSystem {
    constructor(db, gameEngine) {
        this.db = db;
        this.game = gameEngine;
        this.matchmakingQueue = [];
        this.activeMatches = new Map();
    }

    async findRankedMatch(player) {
        // Check cooldown
        if (player.last_pvp) {
            const minutesSince = moment().diff(moment(player.last_pvp), 'minutes');
            const cooldown = parseInt(process.env.PVP_COOLDOWN_MINUTES) || 10;
            if (minutesSince < cooldown) {
                return {
                    error: `PvP cooldown active! Wait ${cooldown - minutesSince} more minutes.`
                };
            }
        }

        // Check if already in match
        if (this.activeMatches.has(player.phone)) {
            return { error: 'You are already in a PvP match!' };
        }

        // Look for opponent in queue
        const opponentIndex = this.matchmakingQueue.findIndex(
            p => p.phone !== player.phone && Math.abs(p.elo_rating - player.elo_rating) < 200
        );

        if (opponentIndex === -1) {
            // Add to queue
            this.matchmakingQueue.push({
                phone: player.phone,
                elo_rating: player.elo_rating,
                joinedAt: moment()
            });
            
            // Set timeout to remove from queue after 5 minutes
            setTimeout(() => {
                this.removeFromQueue(player.phone);
            }, 5 * 60 * 1000);

            return {
                queued: true,
                message: `🔍 Searching for opponent...\\nELO: ${player.elo_rating}\\nQueue position: ${this.matchmakingQueue.length}`
            };
        }

        // Match found
        const opponentData = this.matchmakingQueue.splice(opponentIndex, 1)[0];
        const opponent = await this.db.getPlayer(opponentData.phone);
        
        return this.startMatch(player, opponent);
    }

    async startMatch(player1, player2) {
        const matchId = `pvp_${Date.now()}`;
        
        const match = {
            id: matchId,
            player1: {
                phone: player1.phone,
                name: player1.name,
                hp: player1.hp,
                maxHp: player1.max_hp,
                power: player1.power,
                elo: player1.elo_rating,
                rank: player1.rank_tier
            },
            player2: {
                phone: player2.phone,
                name: player2.name,
                hp: player2.hp,
                maxHp: player2.max_hp,
                power: player2.power,
                elo: player2.elo_rating,
                rank: player2.rank_tier
            },
            turn: 1,
            currentPlayer: player1.phone,
            actions: {},
            status: 'active',
            startedAt: moment()
        };

        this.activeMatches.set(player1.phone, match);
        this.activeMatches.set(player2.phone, match);

        return {
            match: match,
            opponent: player2,
            message: this.formatMatchStart(match, player1)
        };
    }

    formatMatchStart(match, player) {
        const isPlayer1 = match.player1.phone === player.phone;
        const me = isPlayer1 ? match.player1 : match.player2;
        const opponent = isPlayer1 ? match.player2 : match.player1;
        
        let text = `⚔️ *RANKED PvP MATCH* ⚔️\\n\\n`;
        text += `🆚 ${opponent.name}\\n`;
        text += `🏆 Rank: ${opponent.rank.toUpperCase()} (${opponent.elo} ELO)\\n\\n`;
        text += `📊 *Your Stats*\\n`;
        text += `❤️ HP: ${me.hp}/${me.maxHp}\\n`;
        text += `⚔️ Power: ${me.power}\\n`;
        text += `🏆 Rank: ${me.rank.toUpperCase()} (${me.elo} ELO)\\n\\n`;
        text += `🎮 *Turn 1* - Your turn!\\n`;
        text += `Choose: /attack, /defend, /heal, /special`;
        return text;
    }

    async submitAction(phone, action) {
        const match = this.activeMatches.get(phone);
        if (!match) {
            return { error: 'No active PvP match!' };
        }

        if (match.currentPlayer !== phone) {
            return { error: 'Not your turn! Wait for opponent.' };
        }

        if (!['attack', 'defend', 'heal', 'special'].includes(action.toLowerCase())) {
            return { error: 'Invalid action! Use: attack, defend, heal, special' };
        }

        // Store action
        match.actions[phone] = action.toLowerCase();

        // Get opponent
        const isPlayer1 = match.player1.phone === phone;
        const opponent = isPlayer1 ? match.player2 : match.player1;

        // Check if opponent already acted
        if (match.actions[opponent.phone]) {
            return this.resolveTurn(match);
        }

        // Switch turn
        match.currentPlayer = opponent.phone;

        return {
            waiting: true,
            message: `✅ Action recorded! Waiting for ${opponent.name}...`
        };
    }

    async resolveTurn(match) {
        const p1 = match.player1;
        const p2 = match.player2;
        const p1Action = match.actions[p1.phone];
        const p2Action = match.actions[p2.phone];

        let result = {
            messages: [],
            p1Damage: 0,
            p2Damage: 0,
            p1Heal: 0,
            p2Heal: 0,
            winner: null
        };

        // Process actions simultaneously
        // Player 1 action
        if (p1Action === 'attack') {
            const isDefending = p2Action === 'defend';
            result.p2Damage = this.calculateDamage(p1, p2, isDefending);
            p2.hp -= result.p2Damage;
            result.messages.push(`${p1.name} ⚔️ attacks for *${result.p2Damage}* damage!`);
        } else if (p1Action === 'special') {
            const isDefending = p2Action === 'defend';
            result.p2Damage = this.calculateDamage(p1, p2, isDefending, true);
            p2.hp -= result.p2Damage;
            result.messages.push(`${p1.name} 💥 *SPECIAL* for *${result.p2Damage}* damage!`);
        } else if (p1Action === 'heal') {
            result.p1Heal = Math.floor(p1.maxHp * 0.25);
            p1.hp = Math.min(p1.maxHp, p1.hp + result.p1Heal);
            result.messages.push(`${p1.name} 💚 heals *${result.p1Heal}* HP!`);
        } else if (p1Action === 'defend') {
            result.messages.push(`${p1.name} 🛡️ defends!`);
        }

        // Player 2 action (if not defeated)
        if (p2.hp > 0) {
            if (p2Action === 'attack') {
                const isDefending = p1Action === 'defend';
                result.p1Damage = this.calculateDamage(p2, p1, isDefending);
                p1.hp -= result.p1Damage;
                result.messages.push(`${p2.name} ⚔️ attacks for *${result.p1Damage}* damage!`);
            } else if (p2Action === 'special') {
                const isDefending = p1Action === 'defend';
                result.p1Damage = this.calculateDamage(p2, p1, isDefending, true);
                p1.hp -= result.p1Damage;
                result.messages.push(`${p2.name} 💥 *SPECIAL* for *${result.p1Damage}* damage!`);
            } else if (p2Action === 'heal') {
                result.p2Heal = Math.floor(p2.maxHp * 0.25);
                p2.hp = Math.min(p2.maxHp, p2.hp + result.p2Heal);
                result.messages.push(`${p2.name} 💚 heals *${result.p2Heal}* HP!`);
            } else if (p2Action === 'defend') {
                result.messages.push(`${p2.name} 🛡️ defends!`);
            }
        }

        // Check for winner
        if (p1.hp <= 0 || p2.hp <= 0) {
            if (p1.hp <= 0 && p2.hp <= 0) {
                result.winner = 'draw';
                result.messages.push(`\\n🤝 *DOUBLE KO!* It's a draw!`);
                await this.endMatch(match, null);
            } else if (p2.hp <= 0) {
                result.winner = p1.phone;
                result.messages.push(`\\n🏆 *${p1.name} WINS!*`);
                await this.endMatch(match, p1, p2);
            } else {
                result.winner = p2.phone;
                result.messages.push(`\\n🏆 *${p2.name} WINS!*`);
                await this.endMatch(match, p2, p1);
            }
        } else {
            // Next turn
            match.turn++;
            match.actions = {};
            match.currentPlayer = match.turn % 2 === 1 ? p1.phone : p2.phone;
            
            result.messages.push(`\\n📊 *Turn ${match.turn}*`);
            result.messages.push(`${p1.name}: ${this.formatHealthBar(p1.hp, p1.maxHp)}`);
            result.messages.push(`${p2.name}: ${this.formatHealthBar(p2.hp, p2.maxHp)}`);
        }

        return result;
    }

    calculateDamage(attacker, defender, isDefending, isSpecial = false) {
        let damage = Math.floor((attacker.power || 10) * (0.8 + Math.random() * 0.4));
        if (isSpecial) damage = Math.floor(damage * 1.5);
        if (isDefending) damage = Math.floor(damage * 0.3);
        return Math.max(1, damage);
    }

    formatHealthBar(current, max) {
        const percentage = Math.floor((current / max) * 10);
        const filled = '█'.repeat(percentage);
        const empty = '░'.repeat(10 - percentage);
        return `[${filled}${empty}] ${current}/${max}`;
    }

    async endMatch(match, winner, loser) {
        if (winner) {
            // Calculate ELO changes
            const eloChanges = this.game.calculateEloChange(winner.elo, loser.elo);
            
            // Update winner
            const winnerData = await this.db.getPlayer(winner.phone);
            const newWinnerElo = winnerData.elo_rating + eloChanges.winnerChange;
            const winnerRank = this.game.getRankTier(newWinnerElo);
            
            await this.db.updatePlayer(winner.phone, {
                pvp_wins: winnerData.pvp_wins + 1,
                elo_rating: newWinnerElo,
                rank_tier: winnerRank.tier,
                last_pvp: moment().toISOString()
            });

            // Update loser
            const loserData = await this.db.getPlayer(loser.phone);
            const newLoserElo = Math.max(0, loserData.elo_rating + eloChanges.loserChange);
            const loserRank = this.game.getRankTier(newLoserElo);
            
            await this.db.updatePlayer(loser.phone, {
                pvp_losses: loserData.pvp_losses + 1,
                elo_rating: newLoserElo,
                rank_tier: loserRank.tier,
                last_pvp: moment().toISOString()
            });

            // Record match
            await this.db.recordPvPMatch(
                winner.phone,
                loser.phone,
                winner.phone,
                winner.hp,
                loser.hp,
                eloChanges.winnerChange
            );

            match.eloChange = {
                winner: eloChanges.winnerChange,
                loser: eloChanges.loserChange
            };
        } else {
            // Draw - both players
            for (const player of [match.player1, match.player2]) {
                const data = await this.db.getPlayer(player.phone);
                await this.db.updatePlayer(player.phone, {
                    last_pvp: moment().toISOString()
                });
            }
        }

        // Cleanup
        this.activeMatches.delete(match.player1.phone);
        this.activeMatches.delete(match.player2.phone);
    }

    removeFromQueue(phone) {
        const index = this.matchmakingQueue.findIndex(p => p.phone === phone);
        if (index > -1) {
            this.matchmakingQueue.splice(index, 1);
        }
    }

    getMatch(phone) {
        return this.activeMatches.get(phone);
    }

    async getPvPStats(phone) {
        const player = await this.db.getPlayer(phone);
        const rankInfo = this.game.getRankTier(player.elo_rating);
        
        const totalMatches = player.pvp_wins + player.pvp_losses;
        const winRate = totalMatches > 0 ? Math.round((player.pvp_wins / totalMatches) * 100) : 0;
        
        return {
            rank: rankInfo,
            elo: player.elo_rating,
            wins: player.pvp_wins,
            losses: player.pvp_losses,
            winRate: winRate,
            totalMatches: totalMatches
        };
    }
}

module.exports = PvPSystem;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/systems/pvpSystem.js', 'w') as f:
    f.write(pvp_system)

print("✅ 9. src/systems/pvpSystem.js created")