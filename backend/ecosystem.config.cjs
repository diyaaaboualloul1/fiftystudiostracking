module.exports = {
  apps: [
    {
      name: 'fifty-tracker-backend',
      cwd: '/root/fifty-tracker/backend',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      // Env is loaded from .env by server.js (via dotenv).
      // Keep only the non-secret runtime vars here.
      env: {
        NODE_ENV: 'development',
        PORT: 3081,
        JWT_EXPIRES_IN: '7d',
        COMPANY_TIMEZONE: 'Asia/Kuwait',
        FRONTEND_URL: 'http://144.91.100.112:3080',
      },
    },
  ],
};
