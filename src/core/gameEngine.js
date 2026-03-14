
game_engine = """const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');

class GameEngine {
    constructor(db) {
        this.db = db;
        this.config = this.loadConfig();
    }

    loadConfig() {
        const configPath = path.join(__dirname, '../config/game_config.json');
        if (fs.existsSync(configPath)) {
            return fs.readJsonSync(configPath);
        }
        return this.getDefaultConfig();
    }

    getDefaultConfig() {
        return {
            enemies: {},
            pets: {},
            crates: {},
            bank_tiers: {},
            shop_items: {},
            promo_codes: {},
            ranks: {}
        };
    }

    // Battle calculations
    calculateDamage(attacker, defender, isDefending = false, isSpecial = false) {
        let baseDamage = attacker.power || 10;
        
        // Add pet damage
        if (attacker.equipped_pet) {
            baseDamage += attacker.equipped_pet.atk || 0;
        }

        // Random variance (80% - 120%)
        const variance = 0.8 + (Math.random() * 0.4);
        let damage = Math.floor(baseDamage * variance);

        // Special attack (1.5x damage)
        if (isSpecial) {
            damage = Math.floor(damage * 1.5);
        }

        // Defense reduces damage by 70%
        if (isDefending) {
            damage = Math.floor(damage * 0.3);
        }

        return Math.max(1, damage);
    }

    calculateEnemyDamage(enemy, playerIsDefending = false) {
        const [minDmg, maxDmg] = enemy.damage.split('-').map(Number);
        let damage = Math.floor(Math.random() * (maxDmg - minDmg + 1)) + minDmg;
        
        if (playerIsDefending) {
            damage = Math.floor(damage * 0.3);
        }
        
        return damage;
    }

    // Enemy generation
    getRandomEnemy() {
        const rarities = Object.keys(this.config.enemies);
        const rarity = rarities[Math.floor(Math.random() * rarities.length)];
        const enemies = Object.values(this.config.enemies[rarity]);
        const enemy = enemies[Math.floor(Math.random() * enemies.length)];
        
        const hp = Math.floor(Math.random() * (enemy.max_hp - enemy.min_hp + 1)) + enemy.min_hp;
        
        return {
            ...enemy,
            current_hp: hp,
            max_hp: hp,
            id: Math.random().toString(36).substr(2, 9)
        };
    }

    // Pet system
    generatePet(rarity) {
        const pets = this.config.pets[rarity];
        if (!pets || pets.length === 0) return null;
        
        const template = pets[Math.floor(Math.random() * pets.length)];
        const atkVariance = 0.8 + (Math.random() * 0.4);
        const atk = Math.floor(template.base_atk * atkVariance);
        
        return {
            name: template.name,
            emoji: template.emoji,
            rarity: rarity,
            atk: atk,
            special_name: null
        };
    }

    openCrate(crateType) {
        const crate = this.config.crates[crateType];
        if (!crate) return null;

        // Determine rarity based on drop rates
        const roll = Math.random() * 100;
        let cumulative = 0;
        let wonRarity = 'common';
        
        for (const [rarity, chance] of Object.entries(crate.drops)) {
            cumulative += chance;
            if (roll <= cumulative) {
                wonRarity = rarity;
                break;
            }
        }

        const pet = this.generatePet(wonRarity);
        return {
            crate: crate,
            pet: pet,
            rarity: wonRarity
        };
    }

    // Stealing mechanics
    calculateStealSuccess() {
        return Math.random() < (process.env.STEAL_SUCCESS_RATE / 100 || 0.35);
    }

    calculateStealAmount(targetPoints) {
        const minSteal = Math.min(100, Math.floor(targetPoints * 0.05));
        const maxSteal = Math.min(5000, Math.floor(targetPoints * 0.15));
        return Math.floor(Math.random() * (maxSteal - minSteal + 1)) + minSteal;
    }

    calculateStealFine() {
        return Math.floor(Math.random() * 150) + 50;
    }

    // Bank interest
    calculateInterest(balance, tier) {
        const tierInfo = this.config.bank_tiers[tier];
        if (!tierInfo) return 0;
        return Math.floor(balance * tierInfo.interest);
    }

    // Rank/ELO system
    calculateEloChange(winnerElo, loserElo, kFactor = 32) {
        const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
        const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));
        
        return {
            winnerChange: Math.round(kFactor * (1 - expectedWinner)),
            loserChange: Math.round(kFactor * (0 - expectedLoser))
        };
    }

    getRankTier(elo) {
        for (const [tier, data] of Object.entries(this.config.ranks)) {
            if (elo >= data.min_elo && elo <= data.max_elo) {
                return { tier, ...data };
            }
        }
        return { tier: 'bronze', ...this.config.ranks.bronze };
    }

    // Experience and leveling
    calculateExpGain(enemyRarity, isBoss = false) {
        const baseExp = {
            'common': 10,
            'rare': 25,
            'epic': 80,
            'legendary': 200
        }[enemyRarity] || 10;
        
        return isBoss ? baseExp * 5 : baseExp;
    }

    calculateLevelUpExp(level) {
        return level * 100;
    }

    // Promo codes
    validatePromoCode(code) {
        const codeData = this.config.promo_codes[code.toUpperCase()];
        if (!codeData) return { valid: false, reason: 'Invalid code' };
        
        if (!codeData.active) return { valid: false, reason: 'Code inactive' };
        
        if (codeData.expires) {
            const expiry = moment(codeData.expires);
            if (moment().isAfter(expiry)) {
                return { valid: false, reason: 'Code expired' };
            }
        }
        
        return { valid: true, data: codeData };
    }

    // Battle rewards
    calculateBattleRewards(enemy, playerLevel) {
        const baseReward = Math.floor(Math.random() * (enemy.max_reward - enemy.min_reward + 1)) + enemy.min_reward;
        const levelBonus = Math.floor(baseReward * (playerLevel * 0.05));
        
        return {
            points: baseReward + levelBonus,
            exp: enemy.exp || 10
        };
    }

    // Group battle calculations
    calculateGroupDamage(players, enemy) {
        const totalPower = players.reduce((sum, p) => sum + (p.power || 10), 0);
        const avgPower = totalPower / players.length;
        const damage = Math.floor(avgPower * (0.8 + Math.random() * 0.4));
        return Math.max(1, damage);
    }

    // Tutorial
    getTutorialPage(pageNum) {
        const pages = this.config.tutorial?.pages || [];
        return pages[pageNum - 1] || null;
    }

    getTotalTutorialPages() {
        return this.config.tutorial?.pages?.length || 0;
    }
}

module.exports = GameEngine;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/core/gameEngine.js', 'w') as f:
    f.write(game_engine)

print("✅ 6. src/core/gameEngine.js created")