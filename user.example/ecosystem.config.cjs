// PM2 Ecosystem Config
// Manages all processes: Vito server, Cloudflare tunnel, deployed apps
//
// Usage: pm2 start user/ecosystem.config.cjs

module.exports = {
  apps: [
    {
      name: 'vito-server',
      script: './node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: '/path/to/node', // e.g. ~/.nvm/versions/node/v24.x.x/bin/node
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'user/logs/pm2-error.log',
      out_file: 'user/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'cloudflared-tunnel',
      script: 'cloudflared',
      args: 'tunnel --config /path/to/.cloudflared/config.yml run your-tunnel-name',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      error_file: 'user/logs/cloudflared-error.log',
      out_file: 'user/logs/cloudflared-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    // Deployed apps get added here automatically by the apps skill
    // Example:
    // {
    //   name: 'app-my-app',
    //   script: 'server.js',
    //   cwd: '/path/to/vito3.0/user/apps/my-app',
    //   interpreter: '/path/to/node',
    //   autorestart: true,
    //   max_restarts: 10,
    //   min_uptime: '10s',
    //   error_file: 'user/logs/my-app-error.log',
    //   out_file: 'user/logs/my-app-out.log',
    //   log_date_format: 'YYYY-MM-DD HH:mm:ss',
    //   merge_logs: true,
    // },
  ],
};
