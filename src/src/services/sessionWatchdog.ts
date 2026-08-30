/**
 * Detecta sesiones WhatsApp "zombies": Chromium sigue emitiendo onmessage
 * pero isConnected()/sendText() cuelgan (CDP bloqueado). Recupera con
 * close + start-session, igual que el procedimiento manual.
 *
 * Env:
 * - ENABLE_SESSION_WATCHDOG: 'false' para desactivar (default: activo)
 * - SESSION_WATCHDOG_INTERVAL_MS: intervalo de sonda (default 45000)
 * - SESSION_WATCHDOG_PROBE_MS: timeout de isConnected (default 12000)
 * - SESSION_WATCHDOG_FAILS: fallos consecutivos antes de recuperar (default 2)
 */
import CreateSessionUtil from '../../util/createSessionUtil';
import { withTimeout } from '../../util/promiseTimeout';
import { clientsArray } from '../../util/sessionUtil';

type WatchdogContext = {
  serverOptions: any;
  logger: any;
  io: any;
};

const DEFAULT_INTERVAL = 45 * 1000;
const DEFAULT_PROBE = 12 * 1000;
const DEFAULT_FAILS = 2;
const INITIALIZING_MAX_MS = 3 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clientLooksLive(client: any): boolean {
  return Boolean(
    client &&
      typeof client.isConnected === 'function' &&
      typeof client.sendText === 'function'
  );
}

class SessionWatchdog {
  private ctx: WatchdogContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private failCount = new Map<string, number>();

  start(ctx: WatchdogContext) {
    if (process.env.ENABLE_SESSION_WATCHDOG === 'false') {
      ctx.logger?.info?.(
        '[sessionWatchdog] Desactivado (ENABLE_SESSION_WATCHDOG=false)'
      );
      return;
    }
    if (this.timer) return;
    this.ctx = ctx;
    const interval = envInt('SESSION_WATCHDOG_INTERVAL_MS', DEFAULT_INTERVAL);
    ctx.logger?.info?.(
      `[sessionWatchdog] Activo: sonda cada ${Math.round(interval / 1000)}s`
    );
    this.timer = setInterval(() => {
      this.checkAll().catch((err) => {
        ctx.logger?.warn?.(
          `[sessionWatchdog] checkAll: ${(err as Error)?.message || err}`
        );
      });
    }, interval);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private buildReq(session: string, client: any) {
    const util = CreateSessionUtil.getInstance();
    const stored = util.getSessionRuntime(session);
    const ctx = this.ctx;
    return {
      session,
      client,
      body: stored?.body || client?.config || {},
      serverOptions: stored?.serverOptions || ctx?.serverOptions,
      logger: stored?.logger || ctx?.logger,
      io: stored?.io || ctx?.io,
    };
  }

  private async probe(session: string, client: any): Promise<true | string> {
    const probeMs = envInt('SESSION_WATCHDOG_PROBE_MS', DEFAULT_PROBE);
    try {
      const browser = client?.page?.browser?.();
      if (
        browser &&
        typeof browser.isConnected === 'function' &&
        !browser.isConnected()
      ) {
        return 'browser.isConnected() === false';
      }
    } catch {
      /* page puede no existir */
    }

    try {
      await withTimeout(
        Promise.resolve(client.isConnected()),
        probeMs,
        `isConnected(${session})`
      );
      return true;
    } catch (err) {
      return (err as Error)?.message || String(err);
    }
  }

  private async checkAll() {
    if (this.checking) return;
    this.checking = true;
    try {
      const util = CreateSessionUtil.getInstance();
      const sessions = Object.keys(clientsArray || {});
      const neededFails = envInt('SESSION_WATCHDOG_FAILS', DEFAULT_FAILS);

      for (const session of sessions) {
        const client: any = (clientsArray as any)[session];
        if (!client) continue;
        if (util.isRecovering(session)) continue;

        const status = String(client.status || '');
        if (status === 'QRCODE' || status === 'PHONECODE') {
          this.failCount.delete(session);
          continue;
        }

        if (status === 'INITIALIZING') {
          const started = Number(client._initAt) || 0;
          if (started && Date.now() - started > INITIALIZING_MAX_MS) {
            await util.recoverHungSession(
              this.buildReq(session, client),
              session,
              'create() / INITIALIZING colgado más de 3 min'
            );
          }
          continue;
        }

        if (status !== 'CONNECTED' || !clientLooksLive(client)) {
          continue;
        }

        const result = await this.probe(session, client);
        if (result === true) {
          this.failCount.delete(session);
          continue;
        }

        const fails = (this.failCount.get(session) || 0) + 1;
        this.failCount.set(session, fails);
        this.ctx?.logger?.warn?.(
          `[sessionWatchdog] ${session} sonda falló (${fails}/${neededFails}): ${result}`
        );
        if (fails >= neededFails) {
          this.failCount.delete(session);
          await util.recoverHungSession(
            this.buildReq(session, client),
            session,
            result
          );
        }
      }
    } finally {
      this.checking = false;
    }
  }
}

let instance: SessionWatchdog | null = null;

export function startSessionWatchdog(ctx: WatchdogContext) {
  if (!instance) instance = new SessionWatchdog();
  instance.start(ctx);
  return instance;
}

export function getSessionWatchdog() {
  return instance;
}
