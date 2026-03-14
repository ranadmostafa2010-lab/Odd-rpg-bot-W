
termux_setup = """#!/bin/bash

# ODD RPG Bot - Termux Setup Script
# This script prepares your Termux environment for running the bot

echo "🎮 ODD RPG Bot - Termux Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Update packages
echo "📦 Updating packages..."
pkg update -y && pkg upgrade -y

# Install essential packages
echo "📦 Installing essential packages..."
pkg install -y git nodejs-lts python python-pip ffmpeg wget curl

# Install build tools for native modules
echo "🔧 Installing build tools..."
pkg install -y build-essential clang pkg-config

# Install sqlite3
echo "🗄️  Setting up SQLite..."
pkg install -y sqlite

# Create project directory
echo "📁 Creating project directory..."
mkdir -p ~/odd-rpg-baileys
cd ~/odd-rpg-baileys

# Check if Node.js is installed properly
echo "🔍 Checking Node.js installation..."
node_version=$(node --version)
echo "✅ Node.js version: $node_version"

# Check npm
echo "🔍 Checking npm..."
npm_version=$(npm --version)
echo "✅ npm version: $npm_version"

# Install PM2 for process management
echo "⚙️  Installing PM2..."
npm install -g pm2

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p database
mkdir -p session
mkdir -p logs
mkdir -p backups

# Set proper permissions
echo "🔐 Setting permissions..."
chmod -R 755 ~/odd-rpg-baileys

# Create start script
echo "📝 Creating start script..."
cat > start.sh << 'EOF'
#!/bin/bash
cd ~/odd-rpg-baileys
if [ -f "src/index.js" ]; then
    echo "🎮 Starting ODD RPG Bot..."
    node src/index.js
else
    echo "❌ Bot files not found! Please upload the bot files first."
    exit 1
fi
EOF
chmod +x start.sh

# Create PM2 ecosystem file
echo "📝 Creating PM2 config..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'odd-rpg-bot',
    script: './src/index.js',
    cwd: '/data/data/com.termux/files/home/odd-rpg-baileys',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    time: true
  }]
};
EOF

# Create .bashrc alias
echo "📝 Adding aliases..."
if ! grep -q "odd-rpg-bot" ~/.bashrc; then
    echo "
# ODD RPG Bot Aliases
alias rpg-start='cd ~/odd-rpg-baileys && ./start.sh'
alias rpg-logs='cd ~/odd-rpg-baileys && tail -f logs/combined.log'
alias rpg-pm2='cd ~/odd-rpg-baileys && pm2'
" >> ~/.bashrc
fi

echo ""
echo "✅ Setup complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "1. Upload your bot files to ~/odd-rpg-baileys"
echo "2. Copy .env.example to .env and configure it"
echo "3. Run: cd ~/odd-rpg-baileys && npm install"
echo "4. Start the bot with: ./start.sh"
echo ""
echo "Or use PM2:"
echo "  pm2 start ecosystem.config.js"
echo "  pm2 logs odd-rpg-bot"
echo "  pm2 stop odd-rpg-bot"
echo ""
echo "Happy gaming! 🎮"
"""

with open('/mnt/kimi/output/odd-rpg-baileys/termux-setup.sh', 'w') as f:
    f.write(termux_setup)

print("✅ 17. termux-setup.sh created")