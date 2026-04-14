/**
 * PM2: arranque desacoplado de la sesión SSH (daemon + logs en archivo).
 *
 * Uso en el servidor (desde la raíz del repo):
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup   # una vez, para que sobreviva reinicios de la VM
 *
 * Evita ejecutar solo `npm start` dentro de SSH sin PM2: al cerrar el terminal
 * puede enviarse SIGHUP a la jerarquía de procesos y Chromium se cerraba
 * (mitigado también con puppeteerOptions.handleSIGHUP en createSessionUtil).
 */
module.exports = {
  apps: [
    {
      name: 'canserv',
      cwd: __dirname,
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/server.ts',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 30,
      min_uptime: '15s',
      kill_timeout: 90000,
      listen_timeout: 15000,
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
