module.exports = {
  apps: [
    {
      name: 'tarrot',
      cwd: '/home/tr/tarrot',
      script: 'server/start.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '8787',
        TRUST_PROXY: 'true',
        // OLLAMA_API_KEY etc. come from .env (loaded by the app)
      },
      // Fork mode (NOT cluster): cluster_mode made pm2 report "online" without
      // the worker binding the port, causing nginx 502s.
      exec_mode: 'fork',
      max_memory_restart: '300M',
      out_file: '/home/tr/tarrot/logs/pm2-out.log',
      error_file: '/home/tr/tarrot/logs/pm2-error.log',
      time: true,
    },
  ],
};
