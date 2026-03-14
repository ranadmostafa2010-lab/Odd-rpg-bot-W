
readme = """# 🎮 ODD RPG Bot v2.0 - Multiplayer Edition

A feature-rich WhatsApp RPG bot powered by [Baileys](https://github.com/WhiskeySockets/Baileys) for Termux and Node.js environments.

## ✨ Features

### 🎯 Core Gameplay
- **PvE Battles**: Fight AI enemies with Pokemon-style combat
- **PvP Ranked**: Compete against other players with ELO ranking system
- **Group Battles**: Team up with 2-5 players for raid bosses
- **World Bosses**: Server-wide events with massive rewards

### 💰 Economy
- **Bank System**: Store points safely with daily interest
- **Trading**: Trade pets and points with other players
- **Stealing**: Risk/reward system to steal from other players
- **Shop**: Buy potions, shields, and boosts
- **Crates**: Open crates for random pets

### 🐾 Pet System
- 5 rarities: Common, Rare, Epic, Legendary, Mythic
- Pets boost your combat power
- Equip system for active bonuses
- Merge system for upgrades

### 🏆 Ranking System
- Bronze → Silver → Gold → Platinum → Diamond → Master → Grandmaster
- ELO-based matchmaking
- Seasonal rankings

### 🛠️ Admin Features
- Broadcast messages
- Give/remove points
- Ban/unban players
- Spawn bosses manually
- Maintenance mode

## 📱 Installation

### Prerequisites
- Android device with Termux installed
- Node.js 18+ (installed via Termux)
- Git

### Quick Setup

1. **Install Termux** from F-Droid or GitHub (not Play Store version)

2. **Run the setup script:**
```bash
# Download and run setup
curl -o termux-setup.sh https://raw.githubusercontent.com/YOUR_USERNAME/odd-rpg-baileys/main/termux-setup.sh
chmod +x termux-setup.sh
./termux-setup.sh
```

3. **Clone the repository:**
```bash
cd ~
git clone https://github.com/YOUR_USERNAME/odd-rpg-baileys.git
cd odd-rpg-baileys
```

4. **Install dependencies:**
```bash
npm install
```

5. **Configure environment:**
```bash
cp .env.example .env
nano .env  # Edit with your settings
```

6. **Start the bot:**
```bash
npm start
```

Or use PM2 for background running:
```bash
pm2 start ecosystem.config.js
pm2 logs odd-rpg-bot
```

## ⚙️ Configuration

Edit `.env` file:

```env
# Admin Settings
ADMIN_NUMBER=77785701369
BOT_NAME=ODD RPG Bot

# Game Settings
DAILY_REWARD_BASE=1000
STEAL_COOLDOWN_MINUTES=30
PVP_COOLDOWN_MINUTES=10

# Database
DB_PATH=./database/rpg_bot.db

# Session
SESSION_NAME=odd-rpg-session
```

## 🎮 Commands

### Basic Commands
| Command | Description |
|---------|-------------|
| `/start` | Create account |
| `/menu` | Show main menu |
| `/stats` | View your stats |
| `/tutorial` | Game tutorial |
| `/daily` | Claim daily reward |
| `/online` | See online players |
| `/leaderboard` | View rankings |

### Battle Commands
| Command | Description |
|---------|-------------|
| `/battle` | Start PvE battle |
| `/attack` | Attack enemy |
| `/defend` | Defend (reduce damage 70%) |
| `/heal` | Restore HP |
| `/flee` | Try to escape |
| `/special` | Special attack (with pet) |

### PvP Commands
| Command | Description |
|---------|-------------|
| `/ranked` | Find PvP match |
| `/rank` | View your PvP rank |
| `/pvpcancel` | Cancel matchmaking |

### Group Battle Commands (Groups Only)
| Command | Description |
|---------|-------------|
| `/groupbattle` | Start group raid |
| `/joingroup` | Join group battle |
| `/gattack` | Attack boss |
| `/gspecial` | Special attack |
| `/gheal` | Heal party |
| `/gstatus` | Battle status |

### Economy Commands
| Command | Description |
|---------|-------------|
| `/bank` | Bank menu |
| `/bank deposit [amount]` | Deposit points |
| `/bank withdraw [amount]` | Withdraw points |
| `/bank upgrade` | Upgrade bank tier |
| `/shop` | View shop |
| `/buy [item]` | Buy item |
| `/crates` | View crates |
| `/crates [type]` | Open crate |

### Trading Commands
| Command | Description |
|---------|-------------|
| `/trade [phone]` | Request trade |
| `/accept [id]` | Accept trade |
| `/decline [id]` | Decline trade |
| `/trades` | View pending trades |

### Stealing Commands
| Command | Description |
|---------|-------------|
| `/steal` | View targets |
| `/steal [phone]` | Steal from player |
| `/targets` | List targets |

### Pet Commands
| Command | Description |
|---------|-------------|
| `/pets` | View your pets |
| `/equip [number]` | Equip pet |

### Boss Commands
| Command | Description |
|---------|-------------|
| `/boss` | Join world boss |
| `/boss attack` | Attack world boss |
| `/boss status` | Boss status |

### Admin Commands
| Command | Description |
|---------|-------------|
| `/admin givepoints [phone] [amount]` | Give points |
| `/admin broadcast [message]` | Broadcast |
| `/admin maintenance [on/off]` | Maintenance mode |
| `/admin ban [phone] [reason]` | Ban player |
| `/admin unban [phone]` | Unban player |
| `/admin spawnboss [name]` | Spawn boss |
| `/admin stats` | Bot statistics |

## 🏗️ Architecture

```
odd-rpg-baileys/
├── src/
│   ├── index.js              # Main entry point
│   ├── config/
│   │   ├── game_config.json  # Game settings
│   │   └── admin_config.json # Admin settings
│   ├── core/
│   │   ├── database.js       # SQLite database
│   │   ├── gameEngine.js     # Game mechanics
│   │   └── battleManager.js  # Battle management
│   ├── systems/
│   │   ├── pveSystem.js      # PvE battles
│   │   ├── pvpSystem.js      # PvP ranked
│   │   ├── groupBattleSystem.js
│   │   ├── tradingSystem.js
│   │   ├── stealingSystem.js
│   │   ├── bankSystem.js
│   │   └── bossSystem.js
│   └── handlers/
│       └── messageHandler.js # Command router
├── database/                 # SQLite files
├── session/                  # WhatsApp sessions
├── logs/                     # Log files
├── package.json
├── .env.example
├── termux-setup.sh
└── README.md
```

## 🔧 Message Editing (Pokemon-Go Style)

The bot supports message editing for dynamic battle updates:

```javascript
// Example of editing a battle message
await sock.sendMessage(jid, {
    text: 'Updated battle status...',
    edit: originalMessageKey
});
```

This creates a Pokemon-Go style experience where the battle message updates in real-time with:
- Current HP bars
- Turn counter
- Last action taken
- Available options

## 📝 Database Schema

The bot uses SQLite with the following main tables:
- `players` - Player stats, inventory, bank
- `pets` - Owned pets
- `inventory` - Items
- `active_battles` - Current battles
- `pvp_matches` - Match history
- `group_battles` - Group raid data
- `world_bosses` - Boss events
- `trades` - Trade requests
- `messages` - Inbox system
- `logs` - Action logging

## 🛡️ Security Features

- Input sanitization
- Rate limiting (implicit via cooldowns)
- Admin-only commands
- Shield system against stealing
- Ban system

## 🚀 Performance

- SQLite for fast local database
- Connection pooling via Baileys
- Auto-reconnect on disconnect
- Background task scheduling
- Memory-efficient media handling

## 🐛 Troubleshooting

### QR Code not showing
```bash
# Make sure you have qrcode-terminal installed
npm install qrcode-terminal
```

### Database errors
```bash
# Reset database (WARNING: loses all data)
rm -rf database/
mkdir database
npm run db:init
```

### Session expired
```bash
# Clear session and re-scan QR
rm -rf session/
npm start
```

### Port already in use
```bash
# Find and kill process
lsof -i :3000
kill -9 <PID>
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📜 License

MIT License - See LICENSE file for details

## 🙏 Credits

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [Node.js](https://nodejs.org/) - Runtime
- [SQLite](https://sqlite.org/) - Database
- Termux community

## 📞 Support

- GitHub Issues: [Report bugs](https://github.com/YOUR_USERNAME/odd-rpg-baileys/issues)
- Discord: [Join server](https://discord.gg/YOUR_INVITE)
- Email: your-email@example.com

---

**Made with ❤️ for the RPG gaming community**

*Note: This bot is not affiliated with WhatsApp Inc. Use at your own discretion.*
"""

with open('/mnt/kimi/output/odd-rpg-baileys/README.md', 'w') as f:
    f.write(readme)

print("✅ 18. README.md created")