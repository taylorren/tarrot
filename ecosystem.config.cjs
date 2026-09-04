module.exports = {
  apps: [
    {
      name: 'tarrot',
      cwd: '/home/tr/tarrot',
      script: 'server/server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '8787',
        TRUST_PROXY: 'true',
        // OLLAMA_API_KEY etc. come from .env (loaded by the app)
      },
      instances: 1,               // single instance — see "Scaling" note
      max_memory_restart: '300M',
      out_file: '/home/tr/tarrot/logs/pm2-out.log',
      error_file: '/home/tr/tarrot/logs/pm2-error.log',
      time: true,
    },
  ],
};
