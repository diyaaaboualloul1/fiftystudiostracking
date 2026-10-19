module.exports = {
  apps: [
    {
      name: 'fifty-tracker-frontend',
      cwd: '/root/fifty-tracker/frontend',
      script: 'server.cjs',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3080,
        API_TARGET: 'http://127.0.0.1:3081',
      },
    },
  ],
};
