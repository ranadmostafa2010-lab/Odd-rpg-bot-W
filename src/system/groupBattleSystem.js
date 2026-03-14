const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class GroupBattleSystem {
    static activeBattles = new Map();

    static async start(sock, creatorPhone, groupJid, args) {
        const config = global.gameConfig;
        const db = Database.get();
        const creator = GameEngine.getPlayer(creatorPhone);
        
        // Check if already has active group battle in this group
        const existing = db.prepare(`
            SELECT * FROM group_battles 
            WHERE group_id = ? AND status IN ('waiting', 'active')
        `).get(groupJid);
        
        if (existing) {
            return sock.sendMessage(groupJid, { 
                text: `⚠️ A group battle is already in progress!\nUse /gstatus to check it.` 
            });
        }
        
        // Get boss type
        const bossType = args[0] || 'random';
        const boss = this.getBoss(bossType, creator.level);
        
        // Create battle
        const result = db.prepare(`
            INSERT INTO group_battles (
                group_id, boss_name, boss_hp, boss_max_hp, boss_attack, boss_defense,
                status, min_players, max_players, rewards, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            groupJid,
            boss.name,
            boss.hp,
            boss.hp,
            boss.attack,
            boss.defense,
            'waiting',
            config.group.minPlayers,
            config.group.maxPlayers,
            JSON.stringify(boss.rewards),
            creatorPhone
        );
        
        const battleId = result.lastInsertRowid;
        
        // Add creator as first participant
        db.prepare(`
            INSERT INTO group_battle_participants (battle_id, phone, hp, max_hp)
            VALUES (?, ?, ?, ?)
        `).run(battleId, creatorPhone, creator.max_hp, creator.max_hp);
        
        // Update player count
        db.prepare('UPDATE group_battles SET current_players = 1 WHERE id = ?').run(battleId);
        
        // Store in memory
        this.activeBattles.set(battleId, {
            id: battleId,
            boss: { ...boss, currentHp: boss.hp },
            participants: new Map([[creatorPhone, { hp: creator.max_hp, maxHp: creator.max_hp, damage: 0 }]]),
            status: 'waiting',
            turn: 0
        });
        
        let text = `👥 *GROUP BATTLE STARTED!* 👥\n\n`;
        text += `🐉 Boss: ${boss.name}\n`;
        text += `❤️ HP: ${Helpers.formatNumber(boss.hp)}\n`;
        text += `⚔️ ATK: ${boss.attack} | 🛡️ DEF: ${boss.defense}\n\n`;
        text += `*Requirements:*\n`;
        text += `Min players: ${config.group.minPlayers}\n`;
        text += `Max players: ${config.group.maxPlayers}\n\n`;
        text += `*Participants (1/${config.group.maxPlayers}):*\n`;
        text += `• ${creator.name} (Leader)\n\n`;
        text += `Join now: /joingroup\n`;
        text += `Battle starts when minimum players join!`;
        
        await sock.sendMessage(groupJid, { text });
        
        // Set auto-start timer
        setTimeout(() => this.checkAutoStart(sock, battleId, groupJid), 60000); // 1 minute
    }
    
    static getBoss(type, playerLevel) {
        const bosses = {
            dragon: {
                name: 'Ancient Dragon',
                hp: 5000,
                attack: 80,
                defense: 50,
                rewards: { exp: 500, points: 2500 }
            },
            demon: {
                name: 'Demon Lord',
                hp: 8000,
                attack: 100,
                defense: 60,
                rewards: { exp: 800, points: 4000 }
            },
            titan: {
                name: 'Dark Titan',
                hp: 12000,
                attack: 120,
                defense: 80,
                rewards: { exp: 1200, points: 6000 }
            },
            random: null
        };
        
        if (type === 'random' || !bosses[type]) {
            const available = ['dragon', 'demon', 'titan'];
            const scaled = available[Math.min(Math.floor(playerLevel / 10), 2)];
            return bosses[scaled];
        }
        
        return bosses[type];
    }
    
    static async join(sock, phone, groupJid, battleId = null) {
        const db = Database.get();
        const config = global.gameConfig;
        const player = GameEngine.getPlayer(phone);
        
        // Find active battle in group
        let battle;
        if (battleId) {
            battle = db.prepare('SELECT * FROM group_battles WHERE id = ? AND group_id = ?').get(battleId, groupJid);
        } else {
            battle = db.prepare(`
                SELECT * FROM group_battles 
                WHERE group_id = ? AND status = 'waiting'
            `).get(groupJid);
        }
        
        if (!battle) {
            return sock.sendMessage(groupJid, { 
                text: '❌ No active group battle. Start one with /groupbattle' 
            });
        }
        
        // Check if already joined
        const existing = db.prepare(`
            SELECT * FROM group_battle_participants 
            WHERE battle_id = ? AND phone = ?
        `).get(battle.id, phone);
        
        if (existing) {
            return sock.sendMessage(Helpers.getJid(phone), { 
                text: '⚠️ You already joined this battle!' 
            });
        }
        
        // Check max players
        if (battle.current_players >= config.group.maxPlayers) {
            return sock.sendMessage(groupJid, { 
                text: '❌ Battle is full!' 
            });
        }
        
        // Add participant
        db.prepare(`
            INSERT INTO group_battle_participants (battle_id, phone, hp, max_hp)
            VALUES (?, ?, ?, ?)
        `).run(battle.id, phone, player.max_hp, player.max_hp);
        
        db.prepare('UPDATE group_battles SET current_players = current_players + 1 WHERE id = ?')
            .run(battle.id);
        
        // Update memory
        const memBattle = this.activeBattles.get(battle.id);
        if (memBattle) {
            memBattle.participants.set(phone, { 
                hp: player.max_hp, 
                maxHp: player.max_hp,
                damage: 0 
            });
        }
        
        const newCount = battle.current_players + 1;
        
        await sock.sendMessage(groupJid, { 
            text: `✅ ${player.name} joined the battle! (${newCount}/${config.group.maxPlayers})` 
        });
        
        // Check if can start
        if (newCount >= config.group.minPlayers) {
            setTimeout(() => this.startCombat(sock, battle.id, groupJid), 5000);
        }
    }
    
    static async leave(sock, phone, groupJid) {
        const db = Database.get();
        
        const participant = db.prepare(`
            SELECT p.*, b.status 
            FROM group_battle_participants p
            JOIN group_battles b ON p.battle_id = b.id
            WHERE p.phone = ? AND b.group_id = ? AND b.status = 'waiting'
        `).get(phone, groupJid);
        
        if (!participant) {
            return sock.sendMessage(Helpers.getJid(phone), { 
                text: '❌ You are not in a waiting battle' 
            });
        }
        
        db.prepare('DELETE FROM group_battle_participants WHERE id = ?').run(participant.id);
        db.prepare('UPDATE group_battles SET current_players = current_players - 1 WHERE id = ?')
            .run(participant.battle_id);
        
        const player = GameEngine.getPlayer(phone);
        await sock.sendMessage(groupJid, { 
            text: `👋 ${player.name} left the battle` 
        });
    }
    
    static async checkAutoStart(sock, battleId, groupJid) {
        const battle = this.activeBattles.get(battleId);
        if (!battle || battle.status !== 'waiting') return;
        
        const db = Database.get();
        const dbBattle = db.prepare('SELECT * FROM group_battles WHERE id = ?').get(battleId);
        
        if (dbBattle.current_players >= global.gameConfig.group.minPlayers) {
            await this.startCombat(sock, battleId, groupJid);
        } else {
            // Cancel due to insufficient players
            db.prepare("UPDATE group_battles SET status = 'cancelled' WHERE id = ?").run(battleId);
            this.activeBattles.delete(battleId);
            
            await sock.sendMessage(groupJid, { 
                text: '❌ Battle cancelled - insufficient players joined' 
            });
        }
    }
    
    static async startCombat(sock, battleId, groupJid) {
        const db = Database.get();
        const battle = this.activeBattles.get(battleId);
        
        db.prepare("UPDATE group_battles SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(battleId);
        
        battle.status = 'active';
        
        let text = `⚔️ *GROUP BATTLE BEGINS!* ⚔️\n\n`;
        text += `🐉 ${battle.boss.name}\n`;
        text += `❤️ ${Helpers.hpBar(battle.boss.currentHp, battle.boss.maxHp)} ${Helpers.formatNumber(battle.boss.currentHp)}/${Helpers.formatNumber(battle.boss.maxHp)}\n\n`;
        text += `*Participants:*\n`;
        
        for (const [phone, data] of battle.participants) {
            const player = GameEngine.getPlayer(phone);
            text += `• ${player.name} ${Helpers.hpBar(data.hp, data.maxHp)}\n`;
        }
        
        text += `\n*Commands:*\n`;
        text += `/gattack - Attack boss\n`;
        text += `/gheal [player] - Heal teammate\n`;
        text += `/gstatus - Battle status`;
        
        await sock.sendMessage(groupJid, { text });
        
        // Boss turn timer
        this.scheduleBossTurn(sock, battleId, groupJid);
    }
    
    static async attack(sock, phone, groupJid) {
        const db = Database.get();
        const config = global.gameConfig;
        
        const participant = db.prepare(`
            SELECT p.*, b.id as battle_id, b.boss_hp, b.boss_max_hp, b.boss_attack, b.boss_defense, b.status
            FROM group_battle_participants p
            JOIN group_battles b ON p.battle_id = b.id
            WHERE p.phone = ? AND b.group_id = ? AND b.status = 'active'
        `).get(phone, groupJid);
        
        if (!participant) {
            return sock.sendMessage(Helpers.getJid(phone), { 
                text: '❌ You are not in an active group battle' 
            });
        }
        
        if (participant.status !== 'active') {
            return sock.sendMessage(Helpers.getJid(phone), { 
                text: '❌ Battle has not started yet' 
            });
        }
        
        const player = GameEngine.getPlayer(phone);
        const equipped = GameEngine.getEquippedPet(phone);
        
        // Calculate damage
        const attackPower = player.attack + (equipped?.attack_bonus || 0);
        const isCrit = Helpers.isCrit();
        const damage = Helpers.calculateDamage(
            { attack: attackPower },
            { defense: participant.boss_defense },
            isCrit
        );
        
        // Update boss HP
        const newBossHp = Math.max(0, participant.boss_hp - damage);
        db.prepare('UPDATE group_battles SET boss_hp = ? WHERE id = ?').run(newBossHp, participant.battle_id);
        
        // Update participant damage dealt
        db.prepare(`
            UPDATE group_battle_participants 
            SET damage_dealt = damage_dealt + ? 
            WHERE id = ?
        `).run(damage, participant.id);
        
        // Update memory
        const memBattle = this.activeBattles.get(participant.battle_id);
        if (memBattle) {
            memBattle.boss.currentHp = newBossHp;
            const pData = memBattle.participants.get(phone);
            if (pData) pData.damage += damage;
        }
        
        // Check for victory
        if (newBossHp <= 0) {
            await this.endBattle(sock, participant.battle_id, groupJid, true);
            return;
        }
        
        // Notify group
        const playerName = player.name;
        await sock.sendMessage(groupJid, { 
            text: `⚔️ ${playerName} ${isCrit ? '💥 CRIT ' : ''}hits ${memBattle?.boss.name || 'Boss'} for *${damage}* damage!\n` +
                `🐉 Boss HP: ${Helpers.hpBar(newBossHp, participant.boss_maxHp)} ${Helpers.formatNumber(newBossHp)}/${Helpers.formatNumber(participant.boss_maxHp)}` 
        });
    }
    
    static async heal(sock, phone, groupJid, targetName) {
        const db = Database.get();
        
        const healer = db.prepare(`
            SELECT p.*, b.id as battle_id
            FROM group_battle_participants p
            JOIN group_battles b ON p.battle_id = b.id
            WHERE p.phone = ? AND b.group_id = ? AND b.status = 'active'
        `).get(phone, groupJid);
        
        if (!healer) {
            return sock.sendMessage(Helpers.getJid(phone), { 
                text: '❌ You are not in an active group battle' 
            });
        }
        
        // Find target by name
        const participants = db.prepare(`
            SELECT p.*, pl.name 
            FROM group_battle_participants p
            JOIN players pl ON p.phone = pl.phone
            WHERE p.battle_id = ? AND p.status = 'active'
        `).all(healer.battle_id);
        
        const target = participants.find(p => 
            p.name.toLowerCase().includes((targetName || '').toLowerCase())
        );
        
        if (!target) {
            return sock.sendMessage(Helpers.getJid(phone), { 
                text: '❌ Player not found. Use /gstatus to see participants.' 
            });
        }
        
        // Calculate heal amount
        const healAmount = Math.floor(target.max_hp * 0.3);
        const newHp = Math.min(target.max_hp, target.hp + healAmount);
        
        db.prepare('UPDATE group_battle_participants SET hp = ?, healing_done = healing_done + ? WHERE id = ?')
            .run(newHp, healAmount, target.id);
        
        const healerName = GameEngine.getPlayer(phone).name;
        
        await sock.sendMessage(groupJid, { 
            text: `💚 ${healerName} healed ${target.name} for *${healAmount}* HP!` 
        });
    }
    
    static async status(sock, groupJid) {
        const db = Database.get();
        
        const battle = db.prepare(`
            SELECT b.*, 
                (SELECT COUNT(*) FROM group_battle_participants WHERE battle_id = b.id) as player_count
            FROM group_battles b
            WHERE b.group_id = ? AND b.status IN ('waiting', 'active')
        `).get(groupJid);
        
        if (!battle) {
            return sock.sendMessage(groupJid, { 
                text: 'No active group battle. Start one with /groupbattle' 
            });
        }
        
        const participants = db.prepare(`
            SELECT p.*, pl.name, pl.level
            FROM group_battle_participants p
            JOIN players pl ON p.phone = pl.phone
            WHERE p.battle_id = ?
            ORDER BY p.damage_dealt DESC
        `).all(battle.id);
        
        let text = `👥 *Group Battle Status*\n\n`;
        text += `🐉 Boss: ${battle.boss_name}\n`;
        
        if (battle.status === 'active') {
            text += `❤️ HP: ${Helpers.hpBar(battle.boss_hp, battle.boss_max_hp)} ${Helpers.formatNumber(battle.boss_hp)}/${Helpers.formatNumber(battle.boss_max_hp)}\n`;
        }
        
        text += `Status: ${battle.status.toUpperCase()}\n`;
        text += `Players: ${battle.player_count}/${battle.max_players}\n\n`;
        
        text += `*Participants:*\n`;
        participants.forEach((p, i) => {
            const status = p.status === 'active' ? '❤️' : '💀';
            text += `${status} ${p.name} (Lv.${p.level})`;
            if (p.damage_dealt > 0) text += ` - ${Helpers.formatNumber(p.damage_dealt)} dmg`;
            if (p.healing_done > 0) text += ` - ${Helpers.formatNumber(p.healing_done)} heal`;
            text += `\n`;
        });
        
        if (battle.status === 'waiting') {
            text += `\nJoin: /joingroup`;
        } else {
            text += `\nAttack: /gattack | Heal: /gheal [name]`;
        }
        
        await sock.sendMessage(groupJid, { text });
    }
    
    static async scheduleBossTurn(sock, battleId, groupJid) {
        // Boss attacks every 30 seconds
        setTimeout(() => this.bossAttack(sock, battleId, groupJid), 30000);
    }
    
    static async bossAttack(sock, battleId, groupJid) {
        const battle = this.activeBattles.get(battleId);
        if (!battle || battle.status !== 'active') return;
        
        const db = Database.get();
        const dbBattle = db.prepare('SELECT * FROM group_battles WHERE id = ?').get(battleId);
        
        // Boss targets random living participant
        const participants = db.prepare(`
            SELECT * FROM group_battle_participants 
            WHERE battle_id = ? AND status = 'active' AND hp > 0
        `).all(battleId);
        
        if (participants.length === 0) {
            await this.endBattle(sock, battleId, groupJid, false);
            return;
        }
        
        const target = participants[Math.floor(Math.random() * participants.length)];
        const targetPlayer = GameEngine.getPlayer(target.phone);
        
        // Calculate damage
        const isCrit = Helpers.isCrit(0.2); // 20% crit chance for boss
        const damage = Helpers.calculateDamage(
            { attack: dbBattle.boss_attack },
            { defense: targetPlayer.defense },
            isCrit
        );
        
        const newHp = Math.max(0, target.hp - damage);
        
        db.prepare('UPDATE group_battle_participants SET hp = ? WHERE id = ?')
            .run(newHp, target.id);
        
        if (newHp <= 0) {
            db.prepare("UPDATE group_battle_participants SET status = 'defeated' WHERE id = ?")
                .run(target.id);
        }
        
        // Update memory
        const pData = battle.participants.get(target.phone);
        if (pData) pData.hp = newHp;
        
        // Notify
        let text = `🐉 *Boss Attack!*\n\n`;
        text += `${dbBattle.boss_name} ${isCrit ? '💥 CRIT ' : ''}attacks ${targetPlayer.name} for *${damage}* damage!`;
        
        if (newHp <= 0) {
            text += `\n💀 ${targetPlayer.name} has been defeated!`;
        } else {
            text += `\n❤️ ${targetPlayer.name}: ${Helpers.hpBar(newHp, target.max_hp)} ${newHp}/${target.max_hp}`;
        }
        
        await sock.sendMessage(groupJid, { text });
        
        // Check if all defeated
        const alive = db.prepare(`
            SELECT COUNT(*) as count FROM group_battle_participants 
            WHERE battle_id = ? AND status = 'active' AND hp > 0
        `).get(battleId).count;
        
        if (alive === 0) {
            await this.endBattle(sock, battleId, groupJid, false);
        } else {
            // Schedule next attack
            this.scheduleBossTurn(sock, battleId, groupJid);
        }
    }
    
    static async endBattle(sock, battleId, groupJid, victory) {
        const db = Database.get();
        const battle = this.activeBattles.get(battleId);
        
        db.prepare("UPDATE group_battles SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(victory ? 'victory' : 'defeat', battleId);
        
        const rewards = JSON.parse(db.prepare('SELECT rewards FROM group_battles WHERE id = ?').get(battleId).rewards);
        
        if (victory) {
            // Distribute rewards
            const participants = db.prepare(`
                SELECT p.*, pl.name 
                FROM group_battle_participants p
                JOIN players pl ON p.phone = pl.phone
                WHERE p.battle_id = ?
                ORDER BY p.damage_dealt DESC
            `).all(battleId);
            
            let text = `🎉 *VICTORY!* 🎉\n\n`;
            text += `${battle.boss.name} has been defeated!\n\n`;
            text += `*Top Damage Dealers:*\n`;
            
            participants.slice(0, 5).forEach((p, i) => {
                const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] || '•';
                text += `${medal} ${p.name}: ${Helpers.formatNumber(p.damage_dealt)} dmg\n`;
            });
            
            text += `\n*Rewards distributed!*`;
            
            // Give rewards to all survivors
            const survivors = participants.filter(p => p.hp > 0);
            const multiplier = global.gameConfig.group.rewardMultiplier;
            
            for (const p of survivors) {
                const expReward = Math.floor(rewards.exp * multiplier * (p.damage_dealt / 1000 + 1));
                const pointReward = Math.floor(rewards.points * multiplier * (p.damage_dealt / 1000 + 1));
                
                GameEngine.addExp(p.phone, expReward);
                GameEngine.addPoints(p.phone, pointReward);
                
                // Personal notification
                await sock.sendMessage(Helpers.getJid(p.phone), {
                    text: `🎁 *Group Battle Rewards*\n\nEXP: +${Helpers.formatNumber(expReward)}\nPoints: +${Helpers.formatNumber(pointReward)}\n\nGreat teamwork!`
                });
            }
            
            await sock.sendMessage(groupJid, { text });
        } else {
            await sock.sendMessage(groupJid, { 
                text: `💀 *DEFEAT*\n\nThe party was wiped out by ${battle.boss.name}.\nBetter luck next time!` 
            });
        }
        
        this.activeBattles.delete(battleId);
    }
    
    static async forceStart(sock, phone, groupJid) {
        // Force start with current players (admin/leader only)
        const db = Database.get();
        const battle = db.prepare(`
            SELECT * FROM group_battles 
            WHERE group_id = ? AND status = 'waiting'
        `).get(groupJid);
        
        if (!battle) {
            return sock.sendMessage(Helpers.getJid(phone), { text: 'No waiting battle to start' });
        }
        
        if (battle.current_players < 1) {
            return sock.sendMessage(Helpers.getJid(phone), { text: 'Need at least 1 player' });
        }
        
        await this.startCombat(sock, battle.id, groupJid);
    }
}

module.exports = GroupBattleSystem;
