const fs = require('fs-extra');
const path = require('path');

class ConfigLoader {
    static config = null;
    static configPath = path.join(__dirname, '..', 'config', 'game_config.json');

    static load() {
        try {
            if (!fs.existsSync(this.configPath)) {
                this.createDefaultConfig();
            }
            
            const fileContent = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(fileContent);
            global.gameConfig = this.config;
            
            console.log('[✓] Configuration loaded successfully');
            return this.config;
        } catch (err) {
            console.error('[!] Failed to load config:', err.message);
            this.config = this.getDefaultConfig();
            global.gameConfig = this.config;
            return this.config;
        }
    }

    static reload() {
        console.log('[i] Reloading configuration...');
        return this.load();
    }

    static get() {
        if (!this.config) {
            return this.load();
        }
        return this.config;
    }

    static createDefaultConfig() {
        const defaultConfig = this.getDefaultConfig();
        const configDir = path.dirname(this.configPath);
        
        fs.ensureDirSync(configDir);
        fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
        console.log('[✓] Default configuration created at:', this.configPath);
    }

    static getDefaultConfig() {
        return {
            botName: process.env.BOT_NAME || 'ODD RPG Bot',
            version: '2.0.0',
            
            features: {
                pvp: process.env.ENABLE_PVP === 'true',
                stealing: process.env.ENABLE_STEALING === 'true',
                trading: process.env.ENABLE_TRADING === 'true',
                groupBattles: process.env.ENABLE_GROUP_BATTLES === 'true',
                worldBosses: process.env.ENABLE_WORLD_BOSSES === 'true',
                bankInterest: process.env.ENABLE_BANK_INTEREST === 'true',
                dailyRewards: process.env.ENABLE_DAILY_REWARDS === 'true',
                pets: process.env.ENABLE_PETS === 'true',
                shop: process.env.ENABLE_SHOP === 'true',
                leaderboard: process.env.ENABLE_LEADERBOARD === 'true'
            },

            cooldowns: {
                daily: parseInt(process.env.DAILY_REWARD_COOLDOWN_MINUTES) || 1440,
                steal: parseInt(process.env.STEAL_COOLDOWN_MINUTES) || 30,
                pvp: parseInt(process.env.PVP_COOLDOWN_MINUTES) || 10,
                groupBattle: parseInt(process.env.GROUP_BATTLE_TIMEOUT_MINUTES) || 5,
                battle: parseInt(process.env.BATTLE_TIMEOUT_MINUTES) || 10,
                trade: parseInt(process.env.TRADE_TIMEOUT_MINUTES) || 60
            },

            economy: {
                dailyBase: parseInt(process.env.DAILY_REWARD_BASE) || 1000,
                dailyPerLevel: parseInt(process.env.DAILY_REWARD_PER_LEVEL) || 100,
                maxStreak: parseInt(process.env.MAX_DAILY_STREAK) || 7,
                streakMultiplier: parseFloat(process.env.STREAK_BONUS_MULTIPLIER) || 0.1,
                stealSuccessRate: parseFloat(process.env.STEAL_SUCCESS_RATE) || 0.4,
                stealAmountPercent: parseFloat(process.env.STEAL_AMOUNT_PERCENT) || 0.1,
                stealPenaltyPercent: parseFloat(process.env.STEAL_PENALTY_PERCENT) || 0.05,
                maxStealsPerDay: parseInt(process.env.MAX_STEALS_PER_DAY) || 5,
                shieldCost: parseInt(process.env.SHIELD_COST) || 500,
                shieldDuration: parseInt(process.env.SHIELD_DURATION_HOURS) || 24
            },

            bankTiers: [
                {
                    tier: 1,
                    maxStorage: parseInt(process.env.BANK_TIER_1_STORAGE) || 10000,
                    interestRate: parseFloat(process.env.BANK_TIER_1_INTEREST) || 0.02,
                    upgradeCost: parseInt(process.env.BANK_TIER_1_UPGRADE_COST) || 5000
                },
                {
                    tier: 2,
                    maxStorage: parseInt(process.env.BANK_TIER_2_STORAGE) || 50000,
                    interestRate: parseFloat(process.env.BANK_TIER_2_INTEREST) || 0.03,
                    upgradeCost: parseInt(process.env.BANK_TIER_2_UPGRADE_COST) || 25000
                },
                {
                    tier: 3,
                    maxStorage: parseInt(process.env.BANK_TIER_3_STORAGE) || 100000,
                    interestRate: parseFloat(process.env.BANK_TIER_3_INTEREST) || 0.04,
                    upgradeCost: parseInt(process.env.BANK_TIER_3_UPGRADE_COST) || 75000
                },
                {
                    tier: 4,
                    maxStorage: parseInt(process.env.BANK_TIER_4_STORAGE) || 500000,
                    interestRate: parseFloat(process.env.BANK_TIER_4_INTEREST) || 0.05,
                    upgradeCost: parseInt(process.env.BANK_TIER_4_UPGRADE_COST) || 200000
                },
                {
                    tier: 5,
                    maxStorage: parseInt(process.env.BANK_TIER_5_STORAGE) || 1000000,
                    interestRate: parseFloat(process.env.BANK_TIER_5_INTEREST) || 0.07,
                    upgradeCost: parseInt(process.env.BANK_TIER_5_UPGRADE_COST) || 500000
                }
            ],

            leveling: {
                maxLevel: parseInt(process.env.MAX_PLAYER_LEVEL) || 100,
                baseExp: parseInt(process.env.BASE_EXP) || 100,
                expMultiplier: parseFloat(process.env.EXP_MULTIPLIER) || 1.5,
                hpPerLevel: parseInt(process.env.HP_PER_LEVEL) || 10,
                attackPerLevel: parseInt(process.env.ATTACK_PER_LEVEL) || 2,
                defensePerLevel: parseInt(process.env.DEFENSE_PER_LEVEL) || 1,
                speedPerLevel: parseInt(process.env.SPEED_PER_LEVEL) || 1
            },

            ranks: [
                { name: 'Bronze', icon: '🥉', min: parseInt(process.env.RANK_BRONZE_MIN) || 0, max: parseInt(process.env.RANK_BRONZE_MAX) || 999 },
                { name: 'Silver', icon: '🥈', min: parseInt(process.env.RANK_SILVER_MIN) || 1000, max: parseInt(process.env.RANK_SILVER_MAX) || 1199 },
                { name: 'Gold', icon: '🥇', min: parseInt(process.env.RANK_GOLD_MIN) || 1200, max: parseInt(process.env.RANK_GOLD_MAX) || 1399 },
                { name: 'Platinum', icon: '💎', min: parseInt(process.env.RANK_PLATINUM_MIN) || 1400, max: parseInt(process.env.RANK_PLATINUM_MAX) || 1599 },
                { name: 'Diamond', icon: '💠', min: parseInt(process.env.RANK_DIAMOND_MIN) || 1600, max: parseInt(process.env.RANK_DIAMOND_MAX) || 1799 },
                { name: 'Master', icon: '👑', min: parseInt(process.env.RANK_MASTER_MIN) || 1800, max: parseInt(process.env.RANK_MASTER_MAX) || 1999 },
                { name: 'Grandmaster', icon: '🏆', min: parseInt(process.env.RANK_GRANDMASTER_MIN) || 2000, max: 99999 }
            ],

            pvp: {
                winEloGain: parseInt(process.env.PVP_WIN_ELO_GAIN) || 25,
                loseEloLoss: parseInt(process.env.PVP_LOSE_ELO_LOSS) || 15,
                streakBonus: parseInt(process.env.PVP_STREAK_BONUS) || 5
            },

            pets: {
                maxPets: parseInt(process.env.MAX_PETS_PER_PLAYER) || 50,
                maxLevel: parseInt(process.env.MAX_PET_LEVEL) || 50,
                expPerBattle: parseInt(process.env.PET_EXP_PER_BATTLE) || 10,
                rarities: {
                    'Common': {
                        chance: parseFloat(process.env.PET_COMMON_CHANCE) || 0.50,
                        multiplier: parseFloat(process.env.PET_COMMON_MULTIPLIER) || 1.0,
                        color: '⚪'
                    },
                    'Rare': {
                        chance: parseFloat(process.env.PET_RARE_CHANCE) || 0.30,
                        multiplier: parseFloat(process.env.PET_RARE_MULTIPLIER) || 1.5,
                        color: '🔵'
                    },
                    'Epic': {
                        chance: parseFloat(process.env.PET_EPIC_CHANCE) || 0.15,
                        multiplier: parseFloat(process.env.PET_EPIC_MULTIPLIER) || 2.0,
                        color: '🟣'
                    },
                    'Legendary': {
                        chance: parseFloat(process.env.PET_LEGENDARY_CHANCE) || 0.04,
                        multiplier: parseFloat(process.env.PET_LEGENDARY_MULTIPLIER) || 3.0,
                        color: '🟡'
                    },
                    'Mythic': {
                        chance: parseFloat(process.env.PET_MYTHIC_CHANCE) || 0.01,
                        multiplier: parseFloat(process.env.PET_MYTHIC_MULTIPLIER) || 5.0,
                        color: '🔴'
                    }
                },
                types: [
                    { type: 'Wolf', hp: 5, attack: 3, defense: 2, speed: 3 },
                    { type: 'Tiger', hp: 8, attack: 5, defense: 3, speed: 4 },
                    { type: 'Dragon', hp: 12, attack: 7, defense: 5, speed: 5 },
                    { type: 'Phoenix', hp: 10, attack: 6, defense: 4, speed: 6 },
                    { type: 'Golem', hp: 15, attack: 5, defense: 8, speed: 1 },
                    { type: 'Unicorn', hp: 8, attack: 4, defense: 3, speed: 7 }
                ]
            },

            crates: {
                'Common': {
                    cost: parseInt(process.env.CRATE_COMMON_COST) || 100,
                    minPets: parseInt(process.env.CRATE_COMMON_MIN_PETS) || 1,
                    maxPets: parseInt(process.env.CRATE_COMMON_MAX_PETS) || 2,
                    rarityBoost: parseFloat(process.env.CRATE_COMMON_RARITY_BOOST) || 0
                },
                'Rare': {
                    cost: parseInt(process.env.CRATE_RARE_COST) || 500,
                    minPets: parseInt(process.env.CRATE_RARE_MIN_PETS) || 2,
                    maxPets: parseInt(process.env.CRATE_RARE_MAX_PETS) || 3,
                    rarityBoost: parseFloat(process.env.CRATE_RARE_RARITY_BOOST) || 0.10
                },
                'Epic': {
                    cost: parseInt(process.env.CRATE_EPIC_COST) || 2000,
                    minPets: parseInt(process.env.CRATE_EPIC_MIN_PETS) || 3,
                    maxPets: parseInt(process.env.CRATE_EPIC_MAX_PETS) || 4,
                    rarityBoost: parseFloat(process.env.CRATE_EPIC_RARITY_BOOST) || 0.20
                },
                'Legendary': {
                    cost: parseInt(process.env.CRATE_LEGENDARY_COST) || 10000,
                    minPets: parseInt(process.env.CRATE_LEGENDARY_MIN_PETS) || 4,
                    maxPets: parseInt(process.env.CRATE_LEGENDARY_MAX_PETS) || 5,
                    rarityBoost: parseFloat(process.env.CRATE_LEGENDARY_RARITY_BOOST) || 0.30
                }
            },

            combat: {
                critChance: parseFloat(process.env.CRIT_CHANCE) || 0.15,
                critMultiplier: parseFloat(process.env.CRIT_MULTIPLIER) || 2.0,
                defendReduction: parseFloat(process.env.DEFEND_REDUCTION) || 0.70,
                fleeBaseChance: parseFloat(process.env.FLEE_BASE_CHANCE) || 0.50,
                healPercentage: parseFloat(process.env.HEAL_PERCENTAGE) || 0.30,
                specialMultiplier: parseFloat(process.env.SPECIAL_ATTACK_MULTIPLIER) || 2.5
            },

            shopItems: JSON.parse(process.env.SHOP_ITEMS || '[]'),

            group: {
                minPlayers: parseInt(process.env.GROUP_BATTLE_MIN_PLAYERS) || 2,
                maxPlayers: parseInt(process.env.GROUP_BATTLE_MAX_PLAYERS) || 5,
                rewardMultiplier: parseFloat(process.env.GROUP_BATTLE_REWARD_MULTIPLIER) || 1.5
            },

            worldBoss: {
                duration: parseInt(process.env.WORLD_BOSS_DURATION_MINUTES) || 30,
                spawnInterval: parseInt(process.env.WORLD_BOSS_SPAWN_INTERVAL_HOURS) || 4,
                minPlayers: parseInt(process.env.WORLD_BOSS_MIN_PLAYERS) || 3,
                rewardTopPercent: parseInt(process.env.WORLD_BOSS_REWARD_TOP_PERCENT) || 10
            },

            security: {
                maxCommandsPerMinute: parseInt(process.env.MAX_COMMANDS_PER_MINUTE) || 20,
                maxFailedLogins: parseInt(process.env.MAX_FAILED_LOGINS) || 5,
                autoBanDuration: parseInt(process.env.AUTO_BAN_DURATION_HOURS) || 24,
                rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES) || 1
            }
        };
    }

    static updateConfig(updates) {
        this.config = { ...this.config, ...updates };
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        global.gameConfig = this.config;
    }

    static getConfigValue(path) {
        const keys = path.split('.');
        let value = this.config;
        
        for (const key of keys) {
            if (value === undefined || value === null) return undefined;
            value = value[key];
        }
        
        return value;
    }
}

module.exports = ConfigLoader;
