const moment = require('moment');
const gameConfig = require('../config/game_config.json');

class Helpers {
    static formatNumber(num) {
        if (!num) return '0';
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    static formatPhone(phone) {
        return phone.replace(/[^0-9]/g, '');
    }

    static getJid(phone) {
        return this.formatPhone(phone) + '@s.whatsapp.net';
    }

    static calculateLevel(exp) {
        const config = global.gameConfig?.leveling || { baseExp: 100, expMultiplier: 1.5, maxLevel: 100 };
        let level = 1;
        let required = config.baseExp;
        
        while (exp >= required && level < config.maxLevel) {
            exp -= required;
            level++;
            required = Math.floor(config.baseExp * Math.pow(config.expMultiplier, level - 1));
        }
        return level;
    }

    static getRequiredExp(level) {
        const config = global.gameConfig?.leveling || { baseExp: 100, expMultiplier: 1.5 };
        if (level <= 1) return 0;
        return Math.floor(config.baseExp * Math.pow(config.expMultiplier, level - 2));
    }

    static getTotalExpForLevel(targetLevel) {
        let total = 0;
        for (let i = 1; i < targetLevel; i++) {
            total += this.getRequiredExp(i + 1);
        }
        return total;
    }

    static getRank(elo) {
        const config = global.gameConfig;
        if (!config?.ranks) return { name: 'Bronze', icon: '🥉', min: 0, max: 999 };
        
        for (const rank of config.ranks) {
            if (elo >= rank.min && elo <= rank.max) {
                return rank;
            }
        }
        return config.ranks[config.ranks.length - 1];
    }

    static getNextRank(elo) {
        const config = global.gameConfig;
        if (!config?.ranks) return null;
        
        for (let i = 0; i < config.ranks.length - 1; i++) {
            if (elo >= config.ranks[i].min && elo <= config.ranks[i].max) {
                return config.ranks[i + 1];
            }
        }
        return null;
    }

    static getRandomEnemy(playerLevel) {
        const config = global.gameConfig;
        const enemies = [
            { name: 'Slime', hp: 30, attack: 5, defense: 2, exp: 10, points: 50, minLevel: 1 },
            { name: 'Goblin', hp: 50, attack: 8, defense: 3, exp: 20, points: 100, minLevel: 1 },
            { name: 'Wolf', hp: 70, attack: 12, defense: 4, exp: 35, points: 150, minLevel: 2 },
            { name: 'Orc', hp: 100, attack: 15, defense: 6, exp: 50, points: 250, minLevel: 3 },
            { name: 'Dark Knight', hp: 150, attack: 20, defense: 10, exp: 80, points: 400, minLevel: 5 },
            { name: 'Dragon', hp: 300, attack: 35, defense: 15, exp: 200, points: 1000, minLevel: 10 },
            { name: 'Demon Lord', hp: 500, attack: 50, defense: 25, exp: 500, points: 2500, minLevel: 15 },
            { name: 'Ancient Dragon', hp: 800, attack: 70, defense: 35, exp: 1000, points: 5000, minLevel: 20 },
            { name: 'Dark Emperor', hp: 1200, attack: 100, defense: 50, exp: 2000, points: 10000, minLevel: 25 },
            { name: 'Chaos Behemoth', hp: 2000, attack: 150, defense: 80, exp: 5000, points: 25000, minLevel: 30 }
        ];
        
        const available = enemies.filter(e => playerLevel >= e.minLevel);
        const maxIndex = Math.min(available.length - 1, Math.floor(playerLevel / 3));
        const weighted = available.slice(0, maxIndex + 1);
        
        return weighted[Math.floor(Math.random() * weighted.length)];
    }

    static getWorldBoss() {
        const bosses = [
            { name: 'World Ender', hp: 10000, attack: 150, defense: 80, exp: 5000, points: 25000 },
            { name: 'Eternal Phoenix', hp: 15000, attack: 200, defense: 100, exp: 8000, points: 40000 },
            { name: 'Void Leviathan', hp: 25000, attack: 250, defense: 120, exp: 15000, points: 75000 },
            { name: 'Celestial Titan', hp: 50000, attack: 350, defense: 150, exp: 30000, points: 150000 }
        ];
        return bosses[Math.floor(Math.random() * bosses.length)];
    }

    static calculateDamage(attacker, defender, isCrit = false) {
        const config = global.gameConfig?.combat || { critMultiplier: 2.0 };
        
        let damage = attacker.attack - (defender.defense * 0.5);
        damage = Math.max(1, damage);
        
        // Random variance (±10%)
        const variance = 0.9 + (Math.random() * 0.2);
        damage *= variance;
        
        if (isCrit) {
            damage *= config.critMultiplier;
        }
        
        return Math.floor(damage);
    }

    static isCrit(chance = null) {
        const config = global.gameConfig?.combat || { critChance: 0.15 };
        const critChance = chance || config.critChance;
        return Math.random() < critChance;
    }

    static canFlee(attackerSpeed, defenderSpeed) {
        const config = global.gameConfig?.combat || { fleeBaseChance: 0.5 };
        const speedDiff = (attackerSpeed - defenderSpeed) / 100;
        const chance = Math.min(0.9, config.fleeBaseChance + speedDiff);
        return Math.random() < chance;
    }

    static progressBar(current, max, length = 10) {
        const filled = Math.floor((current / max) * length);
        const empty = length - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    static hpBar(current, max, length = 10) {
        const percent = (current / max) * 100;
        let color = '🟩'; // Green
        if (percent < 50) color = '🟨'; // Yellow
        if (percent < 25) color = '🟥'; // Red
        
        const filled = Math.floor((current / max) * length);
        return color.repeat(filled) + '⬛'.repeat(length - filled);
    }

    static formatTimeLeft(targetTime) {
        const diff = moment(targetTime).diff(moment());
        if (diff <= 0) return 'Ready!';
        
        const duration = moment.duration(diff);
        const days = duration.days();
        const hours = duration.hours();
        const minutes = duration.minutes();
        const seconds = duration.seconds();
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    }

    static formatDuration(minutes) {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
    }

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    static capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    static truncate(str, length = 50) {
        if (!str || str.length <= length) return str;
        return str.substring(0, length) + '...';
    }

    static shuffleArray(array) {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    }

    static randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    static clamp(num, min, max) {
        return Math.min(Math.max(num, min), max);
    }

    static getBankTier(tier) {
        const config = global.gameConfig;
        return config?.bankTiers?.find(t => t.tier === tier) || config?.bankTiers?.[0] || {
            tier: 1,
            maxStorage: 10000,
            interestRate: 0.02,
            upgradeCost: 5000
        };
    }

    static parseArgs(text) {
        const args = [];
        let current = '';
        let inQuotes = false;
        
        for (const char of text) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ' ' && !inQuotes) {
                if (current) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += char;
            }
        }
        
        if (current) args.push(current);
        return args;
    }

    static escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    static isValidPhone(phone) {
        return /^[0-9]{10,15}$/.test(phone.replace(/[^0-9]/g, ''));
    }

    static getRarityColor(rarity) {
        const colors = {
            'Common': '⚪',
            'Rare': '🔵',
            'Epic': '🟣',
            'Legendary': '🟡',
            'Mythic': '🔴'
        };
        return colors[rarity] || '⚪';
    }

    static getRarityName(color) {
        const names = {
            '⚪': 'Common',
            '🔵': 'Rare',
            '🟣': 'Epic',
            '🟡': 'Legendary',
            '🔴': 'Mythic'
        };
        return names[color] || 'Common';
    }
}

module.exports = Helpers;
