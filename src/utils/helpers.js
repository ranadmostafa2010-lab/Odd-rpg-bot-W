
helpers_js = """const moment = require('moment');

class Helpers {
    static formatNumber(num) {
        return num.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    }

    static formatTimeLeft(targetTime) {
        const now = moment();
        const target = moment(targetTime);
        const diff = moment.duration(target.diff(now));
        
        if (diff.asSeconds() <= 0) return 'Ready!';
        
        const hours = Math.floor(diff.asHours());
        const minutes = diff.minutes();
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    static calculateLevel(exp) {
        let level = 1;
        let expNeeded = 100;
        let remainingExp = exp;
        
        while (remainingExp >= expNeeded) {
            remainingExp -= expNeeded;
            level++;
            expNeeded = level * 100;
        }
        
        return {
            level: level,
            currentExp: remainingExp,
            expNeeded: expNeeded,
            progress: Math.floor((remainingExp / expNeeded) * 100)
        };
    }

    static generateRandomId(length = 8) {
        return Math.random().toString(36).substring(2, 2 + length);
    }

    static clamp(num, min, max) {
        return Math.min(Math.max(num, min), max);
    }

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static isValidPhone(phone) {
        return /^\\d{10,15}$/.test(phone.replace(/\\D/g, ''));
    }

    static sanitizeInput(input) {
        if (typeof input !== 'string') return '';
        return input.replace(/[<>\"']/g, '').trim();
    }

    static chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    static formatHealthBar(current, max, length = 10) {
        const percentage = Math.floor((current / max) * length);
        const filled = '█'.repeat(percentage);
        const empty = '░'.repeat(length - percentage);
        return `[${filled}${empty}] ${current}/${max}`;
    }

    static getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    static shuffleArray(array) {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    }

    static timeSince(date) {
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);
        
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + ' years ago';
        
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + ' months ago';
        
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + ' days ago';
        
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + ' hours ago';
        
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + ' minutes ago';
        
        return Math.floor(seconds) + ' seconds ago';
    }
}

module.exports = Helpers;
"""

with open('/mnt/kimi/output/odd-rpg-baileys/src/utils/helpers.js', 'w') as f:
    f.write(helpers_js)

print("✅ 19. src/utils/helpers.js created")