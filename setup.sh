#!/bin/bash
set -e
echo "╔══════════════════════════════════╗"
echo "║  ODD RPG BOT — Auto Setup        ║"
echo "╚══════════════════════════════════╝"

# Detect environment
if   [[ -n "$REPL_ID" ]];                    then ENV="replit"
elif [[ -d "/data/data/com.termux" ]];       then ENV="termux"
else                                              ENV="linux"; fi
echo "Detected: $ENV"

# Termux packages
if [[ "$ENV" == "termux" ]]; then
  pkg update -y && pkg upgrade -y
  pkg install -y nodejs git openssl make gcc
fi

# Replit config
if [[ "$ENV" == "replit" ]]; then
  cat > .replit << 'EOF'
run = "node src/index.js"
language = "nodejs"
[[ports]]
localPort = 3000
externalPort = 80
EOF
fi

# Folders
mkdir -p src/config src/core src/systems src/handlers database session logs

# .env
if [[ ! -f .env ]]; then
cat > .env << 'EOF'
ADMIN_NUMBER=1234567890
BOT_NAME=ODD RPG Bot
DB_PATH=./database/rpg_bot.db
SESSION_NAME=odd-rpg-session
PORT=3000
EOF
echo "✅ .env created — SET YOUR ADMIN_NUMBER!"
fi

npm install --no-optional

# Check sqlite3
node -e "require('better-sqlite3')" 2>/dev/null || npm rebuild better-sqlite3

# PM2
if [[ "$ENV" != "replit" ]]; then
  npm install -g pm2 2>/dev/null || true
fi

echo ""
echo "✅ SETUP DONE"
echo "1. Edit .env → set ADMIN_NUMBER"
echo "2. Edit src/config/admin_config.json → set your number"
echo "3. npm start  (or pm2 start ecosystem.config.js)"