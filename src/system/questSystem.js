const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class QuestSystem {
    static defaultQuests = [
        {
            id: 'daily_battle',
            name: 'Daily Warrior',
            description: 'Win 3 battles today',
            type: 'daily',
            target: 3,
            reward: { exp: 100, points: 500 }
        },
        {
            id: 'daily_pvp',
            name: 'PvP Challenger',
            description: 'Win 1 PvP match today',
            type: 'daily',
            target: 1,
            reward: { exp: 200, points: 1000 }
        },
        {
            id: 'weekly_steal',
            name: 'Master Thief',
            description: 'Successfully steal 10 times this week',
            type: 'weekly',
            target: 10,
            reward: { exp: 500, points: 2500 }
        },
        {
            id: 'weekly_boss',
            name: 'Boss Hunter',
            description: 'Deal 10,000 damage to world bosses this week',
            type: 'weekly',
            target: 10000,
            reward: { exp: 1000, points: 5000 }
        },
        {
            id: 'reach_level_10',
            name: 'Rising Star',
            description: 'Reach level 10',
            type: 'achievement',
            target: 10,
            reward: { exp: 500, points: 2000, title: 'Rising Star' }
        },
        {
            id: 'win_100_pvp',
            name: 'PvP Master',
            description: 'Win 100 PvP matches',
            type: 'achievement',
            target: 100,
            reward: { exp: 5000, points: 25000, title: 'PvP Master' }
        }
    ];

    static async list(sock, phone, jid) {
        const db = Database.get();
        const player = GameEngine.getPlayer(phone);
        
        // Get or create player quests
        let quests = db.prepare('SELECT * FROM quests WHERE phone = ? AND status = ?').all(phone, 'active');
        
        // Generate daily quests if none exist
        if (quests.length === 0) {
            await this.generateDailyQuests(phone);
            quests = db.prepare('SELECT * FROM quests WHERE phone = ? AND status = ?').all(phone, 'active');
        }
        
        if (quests.length === 0) {
            return sock.sendMessage(jid, { text: 'No active quests. Check back tomorrow!' });
        }
        
        let text = `📜 *Your Quests*\n\n`;
        
        quests.forEach(q => {
            const percent = Math.min(100, (q.progress / q.target) * 100);
            const status = q.progress >= q.target ? '✅ Complete!' : `${q.progress}/${q.target}`;
            
            text += `*${q.name}* (${q.type})\n`;
            text += `${q.description}\n`;
            text += `${Helpers.progressBar(q.progress, q.target, 10)} ${percent.toFixed(0)}%\n`;
            text += `Status: ${status}\n`;
            
            if (q.progress >= q.target) {
                text += `Claim: /claimreward ${q.id}\n`;
            }
            
            text += `\n`;
        });
        
        await sock.sendMessage(jid, { text });
    }
    
    static async generateDailyQuests(phone) {
        const db = Database.get();
        
        // Clear old daily quests
        db.prepare("DELETE FROM quests WHERE phone = ? AND type = 'daily'").run(phone);
        
        // Add new daily quests
        const dailyQuests = this.defaultQuests.filter(q => q.type === 'daily');
        
        for (const quest of dailyQuests) {
            const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            
            db.prepare(`
                INSERT INTO quests (phone, quest_id, name, description, type, target, rewards, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                phone,
                quest.id,
                quest.name,
                quest.description,
                quest.type,
                quest.target,
                JSON.stringify(quest.reward),
                expires
            );
        }
    }
    
    static async info(sock, phone, jid, questId) {
        if (!questId) {
            return sock.sendMessage(jid, { text: 'Usage: /questinfo [quest number from /quests]' });
        }
        
        const db = Database.get();
        const quests = db.prepare('SELECT * FROM quests WHERE phone = ?').all(phone);
        
        const num = parseInt(questId);
        if (num < 1 || num > quests.length) {
            return sock.sendMessage(jid, { text: '❌ Invalid quest number' });
        }
        
        const quest = quests[num - 1];
        const reward = JSON.parse(quest.rewards);
        
        let text = `📜 *${quest.name}*\n\n`;
        text += `Type: ${quest.type}\n`;
        text += `Description: ${quest.description}\n`;
        text += `Progress: ${quest.progress}/${quest.target}\n`;
        text += `Status: ${quest.status}\n\n`;
        text += `*Rewards:*\n`;
        text += `⭐ ${Helpers.formatNumber(reward.exp)} EXP\n`;
        text += `💰 ${Helpers.formatNumber(reward.points)} points`;
        if (reward.title) text += `\n🏆 Title: "${reward.title}"`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async claim(sock, phone, jid, questNum) {
        if (!questNum) {
            return sock.sendMessage(jid, { text: 'Usage: /claimreward [quest number]' });
        }
        
        const db = Database.get();
        const quests = db.prepare('SELECT * FROM quests WHERE phone = ? AND status = ?').all(phone, 'active');
        
        const num = parseInt(questNum);
        if (num < 1 || num > quests.length) {
            return sock.sendMessage(jid, { text: '❌ Invalid quest number' });
        }
        
        const quest = quests[num - 1];
        
        if (quest.progress < quest.target) {
            return sock.sendMessage(jid, { 
                text: `❌ Quest not complete!\nProgress: ${quest.progress}/${quest.target}` 
            });
        }
        
        const reward = JSON.parse(quest.rewards);
        
        // Give rewards
        GameEngine.addExp(phone, reward.exp);
        GameEngine.addPoints(phone, reward.points);
        
        // Mark as completed
        db.prepare("UPDATE quests SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(quest.id);
        
        let text = `🎉 *Quest Completed!*\n\n`;
        text += `${quest.name}\n\n`;
        text += `*Rewards claimed:*\n`;
        text += `⭐ ${Helpers.formatNumber(reward.exp)} EXP\n`;
        text += `💰 ${Helpers.formatNumber(reward.points)} points`;
        if (reward.title) text += `\n🏆 Title: "${reward.title}"`;
        
        await sock.sendMessage(jid, { text });
        
        // Check for level up
        const player = GameEngine.getPlayer(phone);
        const levelResult = Helpers.calculateLevel(player.exp);
        if (levelResult > player.level) {
            // Level up happened
            await sock.sendMessage(jid, { 
                text: `🆙 *LEVEL UP!* ${player.level} → ${levelResult}` 
            });
        }
    }
    
    static updateProgress(phone, questType, amount = 1) {
        const db = Database.get();
        
        const quests = db.prepare(`
            SELECT * FROM quests 
            WHERE phone = ? AND type = ? AND status = 'active'
        `).all(phone, questType);
        
        for (const quest of quests) {
            const newProgress = Math.min(quest.target, quest.progress + amount);
            db.prepare('UPDATE quests SET progress = ? WHERE id = ?').run(newProgress, quest.id);
        }
    }
    
    static async checkAchievement(phone, achievementId) {
        const db = Database.get();
        
        // Check if already unlocked
        const existing = db.prepare('SELECT * FROM achievements WHERE phone = ? AND achievement_id = ?')
            .get(phone, achievementId);
        
        if (existing) return;
        
        const achievement = this.defaultQuests.find(q => q.id === achievementId && q.type === 'achievement');
        if (!achievement) return;
        
        // Add to achievements
        db.prepare(`
            INSERT INTO achievements (phone, achievement_id, name, description, category, max_progress, reward_claimed)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(phone, achievementId, achievement.name, achievement.description, 'achievement', achievement.target);
    }
    
    static async unlockAchievement(phone, achievementId) {
        const db = Database.get();
        
        db.prepare(`
            UPDATE achievements 
            SET unlocked_at = CURRENT_TIMESTAMP, progress = max_progress 
            WHERE phone = ? AND achievement_id = ?
        `).run(phone, achievementId);
        
        // Notify player
        const achievement = this.defaultQuests.find(q => q.id === achievementId);
        if (achievement) {
            await global.sock.sendMessage(Helpers.getJid(phone), {
                text: `🏆 *Achievement Unlocked!*\n\n${achievement.name}\n${achievement.description}\n\nClaim reward: /claimreward`
            });
        }
    }
}

module.exports = QuestSystem;
