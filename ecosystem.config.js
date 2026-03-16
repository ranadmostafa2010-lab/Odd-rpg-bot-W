module.exports = {
  apps: [{
    name:               'odd-rpg-bot',
    script:             'src/index.js',
    watch:              false,
    autorestart:        true,
    restart_delay:      5000,
    max_memory_restart: '512M',
    log_file:           './logs/bot.log',
    error_file:         './logs/error.log',
    out_file:           './logs/out.log',
    merge_logs:         true,
  }]
};