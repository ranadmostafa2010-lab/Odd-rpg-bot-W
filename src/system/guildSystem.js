const GameEngine = require('../core/gameEngine');
const Database = require('../core/database');
const Helpers = require('../utils/helpers');

class GuildSystem {
    static async info(sock, phone, jid) {
        const db = Database.get();
        const player = GameEngine.getPlayer(phone);
        
        // Check if player is in a guild
        const membership = db.prepare(`
            SELECT g.*, gm.rank 
            FROM guild_members gm
            JOIN guilds g ON gm.guild_id = g.id
            WHERE gm.phone = ?
        `).get(phone);
        
        if (!membership) {
            return sock.sendMessage(jid, { 
                text: `🏰 You are not in a guild.\n\nCreate one: /createguild [name]\nJoin one: /joinguild [guild_id]` 
            });
        }
        
        const members = db.prepare(`
            SELECT gm.*, p.name, p.level 
            FROM guild_members gm
            JOIN players p ON gm.phone = p.phone
            WHERE gm.guild_id = ?
            ORDER BY 
                CASE gm.rank 
                    WHEN 'leader' THEN 1 
                    WHEN 'co-leader' THEN 2 
                    WHEN 'elder' THEN 3 
                    ELSE 4 
                END,
                gm.contribution DESC
        `).all(membership.id);
        
        let text = `🏰 *${membership.name}* [${membership.tag}]\n\n`;
        text += `Level: ${membership.level}\n`;
        text += `Members: ${members.length}/${membership.max_members}\n`;
        text += `Treasury: ${Helpers.formatNumber(membership.treasury)} pts\n`;
        text += `Total EXP: ${Helpers.formatNumber(membership.exp)}\n\n`;
        
        text += `*Members:*\n`;
        members.forEach(m => {
            const rankEmoji = {
                'leader': '👑',
                'co-leader': '⭐',
                'elder': '🛡️',
                'member': '⚔️'
            }[m.rank] || '⚔️';
            
            text += `${rankEmoji} ${m.name} (Lv.${m.level}) - ${m.rank}\n`;
            if (m.contribution > 0) {
                text += `   Contributed: ${Helpers.formatNumber(m.contribution)}\n`;
            }
        });
        
        text += `\nYour rank: ${membership.rank}`;
        
        await sock.sendMessage(jid, { text });
    }
    
    static async create(sock, phone, jid, args) {
        const db = Database.get();
        const player = GameEngine.getPlayer(phone);
        
        // Check if already in guild
        const existing = db.prepare('SELECT * FROM guild_members WHERE phone = ?').get(phone);
        if (existing) {
            return sock.sendMessage(jid, { text: '❌ Leave your current guild first: /leaveguild' });
        }
        
        const name = args.join(' ');
        if (!name || name.length < 3 || name.length > 20) {
            return sock.sendMessage(jid, { text: '❌ Guild name must be 3-20 characters' });
        }
        
        // Generate tag (abbreviation)
        const tag = name.substring(0, 3).toUpperCase();
        const guildId = Helpers.generateId();
        
        // Create guild
        const result = db.prepare(`
            INSERT INTO guilds (guild_id, name, tag, leader_phone, members, max_members, level)
            VALUES (?, ?, ?, ?, 1, 20, 1)
        `).run(guildId, name, tag, phone);
        
        // Add creator as leader
        db.prepare(`
            INSERT INTO guild_members (guild_id, phone, rank, contribution)
            VALUES (?, ?, 'leader', 0)
        `).run(result.lastInsertRowid, phone);
        
        await sock.sendMessage(jid, { 
            text: `🏰 *Guild Created!*\n\n` +
                `Name: ${name}\n` +
                `Tag: [${tag}]\n` +
                `ID: ${result.lastInsertRowid}\n\n` +
                `Invite others: /joinguild ${result.lastInsertRowid}` 
        });
    }
    
    static async join(sock, phone, jid, guildId) {
        if (!guildId) {
            return sock.sendMessage(jid, { text: 'Usage: /joinguild [guild_id]' });
        }
        
        const db = Database.get();
        const player = GameEngine.getPlayer(phone);
        
        // Check if already in guild
        const existing = db.prepare('SELECT * FROM guild_members WHERE phone = ?').get(phone);
        if (existing) {
            return sock.sendMessage(jid, { text: '❌ Leave your current guild first' });
        }
        
        const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
        if (!guild) {
            return sock.sendMessage(jid, { text: '❌ Guild not found' });
        }
        
        // Check capacity
        const memberCount = db.prepare('SELECT COUNT(*) as count FROM guild_members WHERE guild_id = ?').get(guildId).count;
        if (memberCount >= guild.max_members) {
            return sock.sendMessage(jid, { text: '❌ Guild is full' });
        }
        
        // Add as member
        db.prepare(`
            INSERT INTO guild_members (guild_id, phone, rank, contribution)
            VALUES (?, ?, 'member', 0)
        `).run(guildId, phone);
        
        db.prepare('UPDATE guilds SET members = members + 1 WHERE id = ?').run(guildId);
        
        await sock.sendMessage(jid, { 
            text: `✅ Joined ${guild.name} [${guild.tag}]!` 
        });
        
        // Notify leader
        await sock.sendMessage(Helpers.getJid(guild.leader_phone), {
            text: `📢 ${player.name} joined your guild!`
        });
    }
    
    static async leave(sock, phone, jid) {
        const db = Database.get();
        
        const membership = db.prepare(`
            SELECT gm.*, g.leader_phone, g.name, g.id as guild_id
            FROM guild_members gm
            JOIN guilds g ON gm.guild_id = g.id
            WHERE gm.phone = ?
        `).get(phone);
        
        if (!membership) {
            return sock.sendMessage(jid, { text: '❌ You are not in a guild' });
        }
        
        // Check if leader
        if (membership.rank === 'leader') {
            // Check if there are other members
            const others = db.prepare(`
                SELECT * FROM guild_members 
                WHERE guild_id = ? AND phone != ?
            `).all(membership.guild_id, phone);
            
            if (others.length > 0) {
                return sock.sendMessage(jid, { 
                    text: '❌ You must transfer leadership or kick all members first' 
                });
            }
            
            // Delete empty guild
            db.prepare('DELETE FROM guilds WHERE id = ?').run(membership.guild_id);
        }
        
        db.prepare('DELETE FROM guild_members WHERE phone = ?').run(phone);
        db.prepare('UPDATE guilds SET members = members - 1 WHERE id = ?').run(membership.guild_id);
        
        await sock.sendMessage(jid, { 
            text: `👋 Left ${membership.name}` 
        });
    }
    
    static async members(sock, phone, jid) {
        // Alias for info
        await this.info(sock, phone, jid);
    }
    
    static async deposit(sock, phone, jid, amount) {
        if (!amount) {
            return sock.sendMessage(jid, { text: 'Usage: /guilddeposit [amount]' });
        }
        
        const depositAmount = parseInt(amount);
        if (!depositAmount || depositAmount <= 0) {
            return sock.sendMessage(jid, { text: '❌ Invalid amount' });
        }
        
        const db = Database.get();
        const player = GameEngine.getPlayer(phone);
        
        if (player.points < depositAmount) {
            return sock.sendMessage(jid, { text: '❌ Insufficient funds' });
        }
        
        const membership = db.prepare('SELECT * FROM guild_members WHERE phone = ?').get(phone);
        if (!membership) {
            return sock.sendMessage(jid, { text: '❌ You are not in a guild' });
        }
        
        // Deduct from player, add to guild
        GameEngine.addPoints(phone, -depositAmount);
        
        db.prepare('UPDATE guilds SET treasury = treasury + ? WHERE id = ?')
            .run(depositAmount, membership.guild_id);
        
        db.prepare('UPDATE guild_members SET contribution = contribution + ? WHERE phone = ?')
            .run(depositAmount, phone);
        
        await sock.sendMessage(jid, { 
            text: `💰 Deposited ${Helpers.formatNumber(depositAmount)} points to guild treasury!` 
        });
    }
    
    static async upgrade(sock, phone, jid) {
        const db = Database.get();
        
        const membership = db.prepare(`
            SELECT gm.*, g.treasury, g.level, g.max_members, g.id as guild_id
            FROM guild_members gm
            JOIN guilds g ON gm.guild_id = g.id
            WHERE gm.phone = ?
        `).get(phone);
        
        if (!membership || membership.rank === 'member') {
            return sock.sendMessage(jid, { text: '❌ Only leaders and co-leaders can upgrade' });
        }
        
        const cost = membership.level * 10000;
        
        if (membership.treasury < cost) {
            return sock.sendMessage(jid, { 
                text: `❌ Need ${Helpers.formatNumber(cost)} points in treasury\nCurrent: ${Helpers.formatNumber(membership.treasury)}` 
            });
        }
        
        db.prepare('UPDATE guilds SET treasury = treasury - ?, level = level + 1, max_members = max_members + 5 WHERE id = ?')
            .run(cost, membership.guild_id);
        
        await sock.sendMessage(jid, { 
            text: `⬆️ Guild upgraded to Level ${membership.level + 1}!\n` +
                `Max members: ${membership.max_members} → ${membership.max_members + 5}\n` +
                `Cost: ${Helpers.formatNumber(cost)} points` 
        });
    }
    
    static async kick(sock, phone, jid, targetName) {
        if (!targetName) {
            return sock.sendMessage(jid, { text: 'Usage: /guildkick [player name]' });
        }
        
        const db = Database.get();
        
        const kicker = db.prepare(`
            SELECT gm.*, g.id as guild_id, g.name
            FROM guild_members gm
            JOIN guilds g ON gm.guild_id = g.id
            WHERE gm.phone = ?
        `).get(phone);
        
        if (!kicker || !['leader', 'co-leader'].includes(kicker.rank)) {
            return sock.sendMessage(jid, { text: '❌ Only leaders and co-leaders can kick' });
        }
        
        // Find target
        const target = db.prepare(`
            SELECT gm.*, p.name, p.phone
            FROM guild_members gm
            JOIN players p ON gm.phone = p.phone
            WHERE gm.guild_id = ? AND p.name LIKE ?
        `).get(kicker.guild_id, `%${targetName}%`);
        
        if (!target) {
            return sock.sendMessage(jid, { text: '❌ Player not found in guild' });
        }
        
        if (target.rank === 'leader') {
            return sock.sendMessage(jid, { text: '❌ Cannot kick the leader' });
        }
        
        if (kicker.rank === 'co-leader' && ['co-leader', 'elder'].includes(target.rank)) {
            return sock.sendMessage(jid, { text: '❌ Co-leaders can only kick members' });
        }
        
        db.prepare('DELETE FROM guild_members WHERE phone = ?').run(target.phone);
        db.prepare('UPDATE guilds SET members = members - 1 WHERE id = ?').run(kicker.guild_id);
        
        await sock.sendMessage(jid, { text: `👢 Kicked ${target.name} from the guild` });
        await sock.sendMessage(Helpers.getJid(target.phone), { 
            text: `👢 You were kicked from ${kicker.name}` 
        });
    }
    
    static async promote(sock, phone, jid, targetName) {
        if (!targetName) {
            return sock.sendMessage(jid, { text: 'Usage: /guildpromote [player name]' });
        }
        
        const db = Database.get();
        
        const promoter = db.prepare(`
            SELECT gm.*, g.id as guild_id
            FROM guild_members gm
            JOIN guilds g ON gm.guild_id = g.id
            WHERE gm.phone = ?
        `).get(phone);
        
        if (!promoter || promoter.rank !== 'leader') {
            return sock.sendMessage(jid, { text: '❌ Only the leader can promote' });
        }
        
        const target = db.prepare(`
            SELECT gm.*, p.name
            FROM guild_members gm
            JOIN players p ON gm.phone = p.phone
            WHERE gm.guild_id = ? AND p.name LIKE ?
        `).get(promoter.guild_id, `%${targetName}%`);
        
        if (!target) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        const ranks = ['member', 'elder', 'co-leader'];
        const currentIndex = ranks.indexOf(target.rank);
        
        if (currentIndex >= ranks.length - 1) {
            return sock.sendMessage(jid, { text: '❌ Already at max rank' });
        }
        
        const newRank = ranks[currentIndex + 1];
        
        db.prepare('UPDATE guild_members SET rank = ? WHERE phone = ?').run(newRank, target.phone);
        
        await sock.sendMessage(jid, { text: `⬆️ Promoted ${target.name} to ${newRank}` });
        await sock.sendMessage(Helpers.getJid(target.phone), { 
            text: `⬆️ You were promoted to ${newRank}!` 
        });
    }
    
    static async demote(sock, phone, jid, targetName) {
        if (!targetName) {
            return sock.sendMessage(jid, { text: 'Usage: /guilddemote [player name]' });
        }
        
        const db = Database.get();
        
        const demoter = db.prepare(`
            SELECT gm.*, g.id as guild_id
            FROM guild_members gm
            JOIN guilds g ON gm.guild_id = g.id
            WHERE gm.phone = ?
        `).get(phone);
        
        if (!demoter || demoter.rank !== 'leader') {
            return sock.sendMessage(jid, { text: '❌ Only the leader can demote' });
        }
        
        const target = db.prepare(`
            SELECT gm.*, p.name
            FROM guild_members gm
            JOIN players p ON gm.phone = p.phone
            WHERE gm.guild_id = ? AND p.name LIKE ?
        `).get(demoter.guild_id, `%${targetName}%`);
        
        if (!target) {
            return sock.sendMessage(jid, { text: '❌ Player not found' });
        }
        
        const ranks = ['member', 'elder', 'co-leader'];
        const currentIndex = ranks.indexOf(target.rank);
        
        if (currentIndex <= 0) {
            return sock.sendMessage(jid, { text: '❌ Already at lowest rank' });
        }
        
        const newRank = ranks[currentIndex - 1];
        
        db.prepare('UPDATE guild_members SET rank = ? WHERE phone = ?').run(newRank, target.phone);
        
        await sock.sendMessage(jid, { text: `⬇️ Demoted ${target.name} to ${newRank}` });
        await sock.sendMessage(Helpers.getJid(target.phone), { 
            text: `⬇️ You were demoted to ${newRank}` 
        });
    }
    
    static async list(sock, jid) {
        const db = Database.get();
        const guilds = db.prepare('SELECT * FROM guilds ORDER BY level DESC, exp DESC LIMIT 10').all();
        
        if (guilds.length === 0) {
            return sock.sendMessage(jid, { text: 'No guilds yet. Create one: /createguild [name]' });
        }
        
        let text = `🏰 *Top Guilds*\n\n`;
        
        guilds.forEach((g, i) => {
            text += `${i + 1}. ${g.name} [${g.tag}]\n`;
            text += `   Level ${g.level} | ${g.members}/${g.max_members} members\n`;
            text += `   Join: /joinguild ${g.id}\n\n`;
        });
        
        await sock.sendMessage(jid, { text });
    }
}

module.exports = GuildSystem;
