import 'dotenv/config';

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import config from './config';
import { initServer } from './index';

/**
 * Limpieza de arranque: si el proceso anterior murió por OOM, sus Chromium
 * quedan huérfanos. En cada reinicio de PM2 los matamos y quitamos locks.
 */
function cleanupOrphanChromiumOnStartup(): void {
  try {
    const baseDir = path.resolve(
      (config as any).customUserDataDir || './userDataDir/'
    );
    if (process.platform === 'win32') {
      return; // En Windows (dev) lo gestiona createSessionUtil por sesión.
    }
    const esc = baseDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      execSync(`pkill -9 -f "${esc}" || true`, { stdio: 'ignore' });
      // eslint-disable-next-line no-console
      console.log(
        `[startup] Chromium huérfanos del userDataDir limpiados: ${baseDir}`
      );
    } catch {
      /* no había procesos */
    }
    try {
      if (fs.existsSync(baseDir)) {
        for (const session of fs.readdirSync(baseDir)) {
          for (const lock of [
            'SingletonLock',
            'SingletonSocket',
            'SingletonCookie',
          ]) {
            const full = path.join(baseDir, session, lock);
            try {
              if (fs.existsSync(full)) fs.unlinkSync(full);
            } catch {
              /* en uso */
            }
          }
        }
      }
    } catch {
      /* noop */
    }
  } catch {
    /* nunca bloquear el arranque por la limpieza */
  }
}

cleanupOrphanChromiumOnStartup();

initServer(config);
