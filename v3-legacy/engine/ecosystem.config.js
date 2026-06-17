module.exports = {
  apps: [{
    name: 'hotel-agent',
    script: 'api-server.js',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '500M',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: {
      NODE_ENV: 'production',
      ENGINE_PORT: 3009,
      AUTH_ENABLED: 'false',
      API_TOKENS: 'hotel-agent-2026'
    }
  }]
};
