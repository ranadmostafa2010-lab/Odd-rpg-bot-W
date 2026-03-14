
boss_system = """const moment = require('moment');
const chalk = require('chalk');

class BossSystem {
    constructor(db, gameEngine) {
        this.db = db;
        this.game = gameEngine;
        this.activeBosses = new Map(); // bossId -> boss data
    }

    async spawnBoss(spawnedBy = null, bossName = null) {
        // Check if there's already an active world boss
        const existing = await this.db.getActiveWorldBoss();
        if (existing) {
            return { error: 'A world boss is already active!', boss: existing };
        }

        // Select boss template
        let template;
        if (bossName) {
            template = this.game.config.bosses?.world_bosses?.find(b => 
                b.name.toLowerCase() === bossName.toLowerCase()
            );
        }
        
        if (!template) {
            const bosses = this.game.config.bosses?.world_bosses || [
                { name: "World Ender", emoji: "🌑", base_hp: 50000, damage: "200-300", rewards: { points_min: 10000, points_max: 25000, guaranteed_legendary: true } },
                { name: "Chaos Titan", emoji: "🗿", base_hp: 75000, damage: "300-450", rewards: { points_min: 20000, points_max: 50000 } },
                { name: "Abyssal Leviathan", emoji: "🐋", base_hp: 100000, damage: "400-600", rewards: { points_min: 30000, points_max: 75000, guaranteed_mythic: true } }
            ];
            template = bosses[Math.floor(Math.random() * bosses.length)];
        }

        const boss = await this.db.spawnWorldBoss(template, spawnedBy);
        
        this.activeBosses.set(boss.id, {
            ...boss,
            emoji: template.emoji,
            damage: template.damage,
            rewards: template.rewards,
            spawnedAt: moment()
        });

        console.log(chalk.yellow(`👹 World Boss spawned: ${boss.boss_name} with ${boss.boss_hp} HP`));

        return {
            success: true,
            boss: boss,
            message: this.formatBossSpawn(boss, template)
        };
    }

    formatBossSpawn(boss, template) {
        let text = `🚨 *WORLD BOSS APPEARED!* 🚨\\n\\n`;
        text += `${template.emoji} *${boss.boss_name}* has emerged!\\n\\n`;
        text += `❤️ HP: ${boss.boss_hp.toLocaleString()}\\n`;
        text += `💀 Damage: ${template.damage}\\n`;
        text += `💰 Rewards: ${template.rewards.points_min.toLocaleString()} - ${template.rewards.points_max.toLocaleString()} points\\n`;
        
        if (template.rewards.guaranteed_legendary) {
            text += `🎁 Guaranteed Legendary Pet!\\n`;
        }
        if (template.rewards.guaranteed_mythic) {
            text += `🎁 Guaranteed Mythic Pet!\\n`;
        }
        
        text += `\\n⚔️ Use /boss to join the battle!\\n`;
        text += `👥 All players can participate!`;
        
        return text;
    }

    async joinBattle(phone) {
        const boss = await this.db.getActiveWorldBoss();
        if (!boss) {
            return { error: 'No active world boss right now!' };
        }

        const player = await this.db.getPlayer(phone);
        
        // Check if already participating
        const participants = await this.db.getWorldBossParticipants(boss.id);
        const alreadyJoined = participants.find(p => p.phone === phone);
        
        if (alreadyJoined) {
            return { error: 'You already joined this battle! Use /boss attack to fight.' };
        }

        // Add participant
        await this.db.addWorldBossParticipant(boss.id, phone);

        return {
            success: true,
            message: `⚔️ You joined the battle against ${boss.boss_name}!\\nUse /boss attack to deal damage!`,
            boss: boss
        };
    }

    async processAttack(phone) {
        const boss = await this.db.getActiveWorldBoss();
        if (!boss) {
            return { error: 'No active world boss!' };
        }

        const player = await this.db.getPlayer(phone);
        const participants = await this.db.getWorldBossParticipants(boss.id);
        const isParticipating = participants.find(p => p.phone === phone);
        
        if (!isParticipating) {
            return { error: 'You must join the battle first! Use /boss' };
        }

        // Calculate damage
        const equippedPet = await this.db.getEquippedPet(phone);
        let damage = Math.floor((player.power || 10) * (0.8 + Math.random() * 0.4));
        
        if (equippedPet) {
            damage += equippedPet.atk;
        }

        // Apply damage
        const updatedBoss = await this.db.updateWorldBossHp(boss.id, damage);
        await this.db.updateWorldBossDamage(boss.id, phone, damage);

        let result = {
            damage: damage,
            totalDamage: isParticipating.damage_dealt + damage,
            bossHp: updatedBoss.boss_hp,
            bossMaxHp: updatedBoss.boss_max_hp,
            defeated: false,
            rewards: null
        };

        // Check if boss defeated
        if (updatedBoss.boss_hp <= 0) {
            result.defeated = true;
            result.rewards = await this.distributeRewards(boss, participants);
            await this.db.defeatWorldBoss(boss.id);
            this.activeBosses.delete(boss.id);
        }

        return result;
    }

    async distributeRewards(boss, participants) {
        const bossData = this.activeBosses.get(boss.id);
        const rewards = bossData?.rewards || { points_min: 10000, points_max: 25000 };
        
        // Sort by damage dealt
        participants.sort((a, b) => b.damage_dealt - a.damage_dealt);
        
        const totalDamage = participants.reduce((sum, p) => sum + p.damage_dealt, 0);
        const rewardResults = [];

        for (const participant of participants) {
            const player = await this.db.getPlayer(participant.phone);
            const damagePercent = participant.damage_dealt / totalDamage;
            
            // Base reward based on damage contribution
            const baseReward = Math.floor(Math.random() * 
                (rewards.points_max - rewards.points_min + 1)) + rewards.points_min;
            const playerReward = Math.floor(baseReward * (0.3 + (damagePercent * 0.7)));
            
            // Bonus for top 3 damage dealers
            let bonus = 0;
            const rank = participants.indexOf(participant);
            if (rank === 0) bonus = 5000;
            else if (rank === 1) bonus = 3000;
            else if (rank === 2) bonus = 1500;

            const totalReward = playerReward + bonus;

            // Update player
            await this.db.updatePlayer(participant.phone, {
                points: player.points + totalReward,
                wins: player.wins + 1
            });

            // Give legendary pet to top damage dealer if guaranteed
            let petReward = null;
            if (rank === 0 && rewards.guaranteed_legendary) {
                petReward = this.game.generatePet('legendary');
                await this.db.addPet(participant.phone, petReward);
            }
            if (rank === 0 && rewards.guaranteed_mythic) {
                petReward = this.game.generatePet('mythic');
                await this.db.addPet(participant.phone, petReward);
            }

            rewardResults.push({
                phone: participant.phone,
                name: player.name,
                points: totalReward,
                pet: petReward,
                rank: rank + 1,
                damage: participant.damage_dealt
            });
        }

        return rewardResults;
    }

    async getBossStatus() {
        const boss = await this.db.getActiveWorldBoss();
        if (!boss) {
            return { error: 'No active world boss.' };
        }

        const participants = await this.db.getWorldBossParticipants(boss.id);
        const bossData = this.activeBosses.get(boss.id);
        
        let text = `👹 *World Boss: ${boss.boss_name}*\\n\\n`;
        text += `${this.formatHealthBar(boss.boss_hp, boss.boss_max_hp)}\\n`;
        text += `⚔️ Participants: ${participants.length}\\n\\n`;
        
        if (participants.length > 0) {
            text += `🏆 *Top Damage Dealers:*\\n`;
            participants.slice(0, 5).forEach((p, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                text += `${medal} ${p.name}: ${p.damage_dealt.toLocaleString()} dmg\\n`;
            });
        }

        return {
            boss: boss,
            participants: participants,
            message: text
        };
    }

    formatHealthBar(current, max) {
        const percentage = Math.max(0, Math.floor((current / max) * 20));
        const filled = '█'.repeat(percentage);
        const empty = '░'.repeat(20 - percentage);
        const percent = Math.max(0, Math.floor((current / max) * 100));
        return `❤️ [${filled}${empty}] ${percent}%\\n${current.toLocaleString()} / ${max.toLocaleString()} HP`;
    }

    async trySpawnRandomBoss(bot) {
        if (Math.random() < 0.1) { // 10% chance every check
            const result = await this.spawnBoss();
            if (result.success && bot) {
                // Notify all players
                const players = await this.db.getAllPlayers();
                for (const player of players) {
                    try {
                        await bot.sendMessage(
                            `${player.phone}@s.whatsapp.net`,
                            result.message
                        );
                    } catch (e) {}
                }
            }
        }
    }
}

module.exports = BossSystem;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/systems/bossSystem.js', 'w') as f:
    f.write(boss_system)

print("✅ 14. src/systems/bossSystem.js created")