const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class WorldBossSystem {
    static activeBosses = new Map();

    static async spawn(sock, bossName = null) {
        const config = global.gameConfig;
        const db = Database.get();
        
        // Check if already has active boss
        const existing = db.prepare("SELECT * FROM world_bosses WHERE status = 'active'").get();
        if (existing) {
            return { success: false, message: 'A world boss is already active' };
        }
        
        // Generate boss
        const boss = bossName ? this.getBossByName(bossName) : Helpers.getWorldBoss();
        const expires = new Date(Date.now() + config.worldBoss.duration * 60000).toISOString();
        
        const result = db.prepare(`
            INSERT INTO world_bosses (
                boss_id, name, hp, max_hp, attack, defense, status, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            Helpers.generateId(),
            boss.name,
            boss.hp,
            boss.hp,
            boss.attack,
            boss.defense,
            'active',
            expires
        );
        
        const bossId = result.lastInsertRowid;
        
        // Store in memory
        this.activeBosses.set(bossId, {
            id: bossId,
            ...boss,
            participants: new Map()
        });
        
        // Broadcast to all players
        const players = db.prepare('SELECT phone FROM players WHERE banned = 0').all();
        
        for (const player of players) {
            try {
                await sock.sendMessage(Helpers.getJid(player.phone), {
                    text: `🐉 *WORLD BOSS APPEARS!* 🐉\n\n` +
                        `*${boss.name}* has spawned!\n` +
                        `❤️ HP: ${Helpers.formatNumber(boss.hp)}\n` +
                        `⚔️ ATK: ${boss.attack} | 🛡️ DEF: ${boss.defense}\n\n` +
                        `Time limit: ${config.worldBoss.duration} minutes\n` +
                        `Use /bossattack to fight!\n` +
                        `/boss for more info`
                });
                await Helpers.sleep(50);
            } catch (e) {}
        }
        
        // Schedule auto-end
        setTimeout(() => this.endBoss(sock, bossId), config.worldBoss.duration * 60000);
        
        return { success: true, bossId };
    }
    
    static getBossByName(name) {
        const bosses = [
            { name: 'World Ender', hp: 10000, attack: 150, defense: 80 },
            { name: 'Eternal Phoenix', hp: 15000, attack: 200, defense: 100 },
            { name: 'Void Leviathan', hp: 25000, attack: 250, defense: 120 },
            { name: 'Celestial Titan', hp: 50000, attack: 350, defense: 150 }
        ];
        
        return bosses.find(b => b.name.toLowerCase().includes(name.toLowerCase())) || bosses[0];
    }
    
    static async info(sock, jid) {
        const db = Database.get();
        const boss = db.prepare("SELECT * FROM world_bosses WHERE status = 'active'").get();
        
        if (!boss) {
            return sock.sendMessage(jid, { 
                text: `🐉 No world boss active.\n\nBosses spawn every ${global.gameConfig.worldBoss.spawnInterval} hours!\nLast defeated bosses: /bosshistory` 
            });
        }
        
        const timeLeft = Helpers.formatTimeLeft(boss.expires_at);
        const damageDealt = db.prepare('SELECT SUM(damage) as total FROM world_boss_damage WHERE boss_id = ?').get(boss.id).total || 0;
        const participants = db.prepare('SELECT COUNT(DISTINCT phone) as count FROM world_boss_damage WHERE boss_id = ?').get(boss.id).count || 0;
        
        let text = `🐉 *World Boss: ${boss.name}*\n\n`;
        text += `❤️ HP: ${Helpers.hpBar(boss.hp, boss.max_hp)} ${Helpers.formatNumber(boss.hp)}/${Helpers.formatNumber(boss.max_hp)}\n`;
        text += `⚔️ ATK: ${boss.attack} | 🛡️ DEF: ${boss.defense}\n\n`;
        text += `⏱️ Time remaining: ${timeLeft}\n`;
        text += `👥 Fighters: ${participants}\n`;
        text += `💥 Total damage dealt: ${Helpers.formatNumber(damageDealt)}\n\n`;
        text += `*Commands:*\n`;
        text += `/bossattack - Attack the boss\n`;
        text += `/bossrewards - See damage rankings\n`;
        text += `/bossstatus - Refresh info`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async attack(sock, phone, jid) {
        const db = Database.get();
        const config = global.gameConfig;
        
        const boss = db.prepare("SELECT * FROM world_bosses WHERE status = 'active'").get();
        if (!boss) {
            return sock.sendMessage(jid, { text: '❌ No world boss is currently active' });
        }
        
        // Check cooldown (5 seconds between attacks)
        const lastAttack = db.prepare(`
            SELECT last_hit FROM world_boss_damage 
            WHERE boss_id = ? AND phone = ?
        `).get(boss.id, phone);
        
        if (lastAttack) {
            const secondsSince = (Date.now() - new Date(lastAttack.last_hit)) / 1000;
            if (secondsSince < 5) {
                return sock.sendMessage(jid, { 
                    text: `⏰ Attack cooldown: ${Math.ceil(5 - secondsSince)}s` 
                });
            }
        }
        
        const player = GameEngine.getPlayer(phone);
        const equipped = GameEngine.getEquippedPet(phone);
        
        // Calculate damage
        const attackPower = player.attack + (equipped?.attack_bonus || 0);
        const isCrit = Helpers.isCrit();
        const damage = Helpers.calculateDamage(
            { attack: attackPower },
            { defense: boss.defense },
            isCrit
        );
        
        // Update boss HP
        const newHp = Math.max(0, boss.hp - damage);
        db.prepare('UPDATE world_bosses SET hp = ?, total_damage = total_damage + ? WHERE id = ?')
            .run(newHp, damage, boss.id);
        
        // Record damage
        const existing = db.prepare('SELECT * FROM world_boss_damage WHERE boss_id = ? AND phone = ?')
            .get(boss.id, phone);
        
        if (existing) {
            db.prepare(`
                UPDATE world_boss_damage 
                SET damage = damage + ?, hits = hits + 1, last_hit = CURRENT_TIMESTAMP 
                WHERE boss_id = ? AND phone = ?
            `).run(damage, boss.id, phone);
        } else {
            db.prepare(`
                INSERT INTO world_boss_damage (boss_id, phone, damage, hits, last_hit)
                VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
            `).run(boss.id, phone, damage);
        }
        
        // Check for kill
        if (newHp <= 0) {
            await this.bossDefeated(sock, boss.id);
            return;
        }
        
        // Personal message
        let text = `⚔️ You ${isCrit ? '💥 CRIT ' : ''}hit ${boss.name} for *${damage}* damage!\n\n`;
        text += `🐉 Boss HP: ${Helpers.hpBar(newHp, boss.max_hp)} ${Helpers.formatNumber(newHp)}/${Helpers.formatNumber(boss.max_hp)}\n`;
        
        const myDamage = db.prepare('SELECT damage FROM world_boss_damage WHERE boss_id = ? AND phone = ?')
            .get(boss.id, phone).damage;
        text += `📊 Your total damage: ${Helpers.formatNumber(myDamage)}`;
        
        await sock.sendMessage(jid, { text });
        
        // Update memory
        const memBoss = this.activeBosses.get(boss.id);
        if (memBoss) {
            memBoss.hp = newHp;
            memBoss.participants.set(phone, (memBoss.participants.get(phone) || 0) + damage);
        }
    }
    
    static async status(sock, jid) {
        // Alias for info
        await this.info(sock, jid);
    }
    
    static async leaderboard(sock, jid) {
        const db = Database.get();
        const boss = db.prepare("SELECT * FROM world_bosses WHERE status = 'active'").get();
        
        if (!boss) {
            // Show last boss results
            const lastBoss = db.prepare(`
                SELECT * FROM world_bosses 
                WHERE status = 'defeated' 
                ORDER BY defeated_at DESC 
                LIMIT 1
            `).get();
            
            if (!lastBoss) {
                return sock.sendMessage(jid, { text: 'No boss history yet' });
            }
            
            const rankings = db.prepare(`
                SELECT wbd.*, p.name 
                FROM world_boss_damage wbd
                JOIN players p ON wbd.phone = p.phone
                WHERE wbd.boss_id = ?
                ORDER BY wbd.damage DESC
                LIMIT 10
            `).all(lastBoss.id);
            
            let text = `📊 *Last Boss: ${lastBoss.name}*\n`;
            text += `Status: ${lastBoss.status.toUpperCase()}\n`;
            text += `Defeated: ${new Date(lastBoss.defeated_at).toLocaleString()}\n\n`;
            text += `*Top Damage Dealers:*\n`;
            
            rankings.forEach((r, i) => {
                const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][i] || '•';
                text += `${medal} ${r.name}: ${Helpers.formatNumber(r.damage)} (${r.hits} hits)\n`;
            });
            
            return sock.sendMessage(jid, { text });
        }
        
        // Current boss rankings
        const rankings = db.prepare(`
            SELECT wbd.*, p.name 
            FROM world_boss_damage wbd
            JOIN players p ON wbd.phone = p.phone
            WHERE wbd.boss_id = ?
            ORDER BY wbd.damage DESC
            LIMIT 15
        `).all(boss.id);
        
        let text = `🏆 *Damage Rankings: ${boss.name}*\n\n`;
        
        if (rankings.length === 0) {
            text += `No attacks yet. Be the first!\n/bossattack`;
        } else {
            rankings.forEach((r, i) => {
                const percent = ((r.damage / boss.total_damage) * 100).toFixed(1);
                text += `${i + 1}. ${r.name}\n`;
                text += `   ${Helpers.formatNumber(r.damage)} dmg (${percent}%) - ${r.hits} hits\n`;
            });
        }
        
        text += `\n⏱️ Time remaining: ${Helpers.formatTimeLeft(boss.expires_at)}`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async history(sock, jid) {
        const db = Database.get();
        const bosses = db.prepare(`
            SELECT * FROM world_bosses 
            WHERE status != 'active'
            ORDER BY defeated_at DESC, spawned_at DESC
            LIMIT 5
        `).all();
        
        if (bosses.length === 0) {
            return sock.sendMessage(jid, { text: 'No boss history yet' });
        }
        
        let text = `📜 *Recent World Bosses*\n\n`;
        
        bosses.forEach(b => {
            const killers = db.prepare('SELECT COUNT(*) as count FROM world_boss_damage WHERE boss_id = ?').get(b.id).count;
            text += `*${b.name}*\n`;
            text += `Status: ${b.status}\n`;
            text += `Fighters: ${killers}\n`;
            if (b.defeated_at) {
                text += `Defeated: ${new Date(b.defeated_at).toLocaleDateString()}\n`;
            } else {
                text += `Expired: ${new Date(b.expires_at).toLocaleDateString()}\n`;
            }
            text += `\n`;
        });
        
        await sock.sendMessage(jid, { text });
    }
    
    static async bossDefeated(sock, bossId) {
        const db = Database.get();
        const boss = db.prepare('SELECT * FROM world_bosses WHERE id = ?').get(bossId);
        
        db.prepare("UPDATE world_bosses SET status = 'defeated', defeated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(bossId);
        
        // Get top damage dealers
        const topDamage = db.prepare(`
            SELECT wbd.*, p.name, p.phone
            FROM world_boss_damage wbd
            JOIN players p ON wbd.phone = p.phone
            WHERE wbd.boss_id = ?
            ORDER BY wbd.damage DESC
            LIMIT 10
        `).all(bossId);
        
        // Calculate rewards
        const baseExp = 1000;
        const basePoints = 5000;
        
        // Distribute rewards
        for (let i = 0; i < topDamage.length; i++) {
            const player = topDamage[i];
            const rank = i + 1;
            
            // Higher ranks get better rewards
            const multiplier = Math.max(0.1, 1 - (i * 0.1));
            const expReward = Math.floor(baseExp * multiplier);
            const pointReward = Math.floor(basePoints * multiplier);
            
            // Bonus for top 3
            let bonusText = '';
            if (rank === 1) bonusText = '🥇 FIRST PLACE! ';
            else if (rank === 2) bonusText = '🥈 Second place! ';
            else if (rank === 3) bonusText = '🥉 Third place! ';
            
            GameEngine.addExp(player.phone, expReward);
            GameEngine.addPoints(player.phone, pointReward);
            
            // Notify player
            await sock.sendMessage(Helpers.getJid(player.phone), {
                text: `🎉 *World Boss Defeated!*\n\n` +
                    `${bonusText}You ranked #${rank} in damage!\n` +
                    `Damage dealt: ${Helpers.formatNumber(player.damage)}\n\n` +
                    `*Rewards:*\n` +
                    `⭐ ${Helpers.formatNumber(expReward)} EXP\n` +
                    `💰 ${Helpers.formatNumber(pointReward)} points`
            });
            
            await Helpers.sleep(100);
        }
        
        // Broadcast to all
        const allPlayers = db.prepare('SELECT phone FROM players WHERE banned = 0').all();
        for (const p of allPlayers) {
            if (!topDamage.find(td => td.phone === p.phone)) {
                await sock.sendMessage(Helpers.getJid(p.phone), {
                    text: `🎉 *${boss.name} Defeated!*\n\n` +
                        `The world boss has been slain by brave warriors!\n` +
                        `Top damage: ${topDamage[0]?.name || 'Unknown'}\n\n` +
                        `Better luck next time! /boss for next spawn`
                });
            }
        }
        
        this.activeBosses.delete(bossId);
    }
    
    static async endBoss(sock, bossId) {
        const db = Database.get();
        const boss = db.prepare('SELECT * FROM world_bosses WHERE id = ?').get(bossId);
        
        if (!boss || boss.status !== 'active') return;
        
        db.prepare("UPDATE world_bosses SET status = 'expired' WHERE id = ?").run(bossId);
        
        // Notify participants
        const participants = db.prepare(`
            SELECT DISTINCT phone FROM world_boss_damage WHERE boss_id = ?
        `).all(bossId);
        
        for (const p of participants) {
            await sock.sendMessage(Helpers.getJid(p.phone), {
                text: `⏰ *${boss.name} Escaped!*\n\n` +
                    `The boss flew away before being defeated.\n` +
                    `Thanks for fighting! Better luck next time.`
            });
        }
        
        this.activeBosses.delete(bossId);
    }
    
    static async forceEnd(sock, bossId) {
        // Admin command to end boss early
        await this.endBoss(sock, bossId);
    }
    
    static startAutoSpawn(sock) {
        const config = global.gameConfig;
        
        // Check every hour if boss should spawn
        setInterval(async () => {
            const db = Database.get();
            const lastBoss = db.prepare(`
                SELECT * FROM world_bosses 
                ORDER BY spawned_at DESC 
                LIMIT 1
            `).get();
            
            if (!lastBoss) {
                // First ever boss
                await this.spawn(sock);
                return;
            }
            
            const hoursSince = (Date.now() - new Date(lastBoss.spawned_at)) / (1000 * 60 * 60);
            
            if (hoursSince >= config.worldBoss.spawnInterval && lastBoss.status !== 'active') {
                await this.spawn(sock);
            }
        }, 60 * 60 * 1000); // Check every hour
    }
}

module.exports = WorldBossSystem;
