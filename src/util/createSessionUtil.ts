/*
 * Copyright 2021 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  create,
  defaultLogger,
  SocketState,
} from '@wppconnect-team/wppconnect';
import { exec } from 'child_process';
import { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { WhatsAppServer } from '../types/WhatsAppServer';
import chatWootClient from './chatWootClient';
import {
  autoDownload,
  callWebHook,
  isStatusOrBroadcastMessage,
  startHelper,
} from './functions';
import { withTimeout } from './promiseTimeout';
import {
  clientsArray,
  deleteSessionOnArray,
  eventEmitter,
} from './sessionUtil';
import Factory from './tokenStore/factory';

const execAsync = promisify(exec);

type SessionRuntime = {
  serverOptions: any;
  logger: any;
  io: any;
  body: any;
};

export default class CreateSessionUtil {
  private static instance: CreateSessionUtil | undefined;

  static getInstance(): CreateSessionUtil {
    if (!CreateSessionUtil.instance) {
      CreateSessionUtil.instance = new CreateSessionUtil();
    }
    return CreateSessionUtil.instance;
  }

  /** Una sola limpieza por sesión a la vez; las demás esperan la misma promesa */
  private static killChromeProcessesPromises = new Map<string, Promise<void>>();
  private static recoveringSessions = new Set<string>();
  private static lastRecoverAt = new Map<string, number>();
  private static sessionRuntime = new Map<string, SessionRuntime>();
  private static readonly RECOVER_COOLDOWN_MS = 120000;

  /**
   * Serializa operaciones de sesión (start/close) para evitar
   * `SingletonLock: File exists` cuando llegan varias peticiones a la vez.
   */
  private static sessionOpChain = new Map<string, Promise<unknown>>();

  private runWithSessionQueue<T>(
    session: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const prev =
      CreateSessionUtil.sessionOpChain.get(session) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    CreateSessionUtil.sessionOpChain.set(session, next);
    return next as Promise<T>;
  }

  /** Rompe una cola colgada (p.ej. create() eterno) para permitir un nuevo start-session. */
  private resetSessionQueue(session: string): void {
    CreateSessionUtil.sessionOpChain.set(session, Promise.resolve());
  }

  isRecovering(session: string): boolean {
    return CreateSessionUtil.recoveringSessions.has(session);
  }

  getSessionRuntime(session: string): SessionRuntime | undefined {
    return CreateSessionUtil.sessionRuntime.get(session);
  }

  private rememberSessionRuntime(session: string, req: any): void {
    CreateSessionUtil.sessionRuntime.set(session, {
      serverOptions: req.serverOptions,
      logger: req.logger,
      io: req.io,
      body: req.body || {},
    });
  }

  /**
   * Recupera una sesión colgada: close (con timeout) + matar Chromium + start-session.
   * Equivale al procedimiento manual disconnect-session + start-session.
   */
  async recoverHungSession(
    req: any,
    session: string,
    reason: string
  ): Promise<void> {
    if (!session) return;
    if (CreateSessionUtil.recoveringSessions.has(session)) return;

    const cooldown = Math.max(
      30000,
      parseInt(process.env.SESSION_WATCHDOG_COOLDOWN_MS || '', 10) ||
        CreateSessionUtil.RECOVER_COOLDOWN_MS
    );
    const last = CreateSessionUtil.lastRecoverAt.get(session) || 0;
    if (Date.now() - last < cooldown) {
      req?.logger?.info?.(
        `[${session}] Recuperación omitida (cooldown ${Math.round(
          cooldown / 1000
        )}s)`
      );
      return;
    }

    CreateSessionUtil.recoveringSessions.add(session);
    CreateSessionUtil.lastRecoverAt.set(session, Date.now());
    this.resetSessionQueue(session);

    const logger = req?.logger;
    logger?.warn?.(
      `[${session}] API/CDP bloqueado (${reason}). Recuperando: disconnect-session + start-session.`
    );

    const client = (clientsArray as any)[session];
    try {
      if (client && typeof client.close === 'function') {
        await withTimeout(
          Promise.resolve(client.close()).catch(() => undefined),
          10000,
          `close(${session})`
        );
      }
    } catch (err) {
      logger?.warn?.(
        `[${session}] close() no respondió: ${(err as Error)?.message || err}`
      );
    }

    try {
      if (req?.serverOptions?.customUserDataDir) {
        await this.killChromeProcessesForUserDataDir(
          req.serverOptions.customUserDataDir + session,
          logger,
          session
        );
      }
    } catch (err) {
      logger?.warn?.(
        `[${session}] kill Chrome: ${(err as Error)?.message || err}`
      );
    }

    try {
      deleteSessionOnArray(session);
    } catch {
      (clientsArray as any)[session] = undefined;
    }
    this.resetSessionQueue(session);

    try {
      await this.createSessionUtil(req, clientsArray, session);
      logger?.info?.(`[${session}] Sesión recuperada (start-session).`);
    } catch (err) {
      logger?.error?.(
        `[${session}] Falló start-session en recuperación: ${
          (err as Error)?.message || err
        }`
      );
    } finally {
      CreateSessionUtil.recoveringSessions.delete(session);
    }
  }

  /** Límite de líneas de consola por sesión para "Waiting for QRCode Scan" (evita spam en sesiones sin vincular). */
  private static readonly MAX_QR_CONSOLE_LOGS = 2;
  private static qrWaitLogCountBySession = new Map<string, number>();

  /**
   * Silencia el ruido de QR en consola: WPPConnect vuelve a loguear en cada refresh del código.
   * Solo deja pasar las primeras {@link MAX_QR_CONSOLE_LOGS} notificaciones por sesión.
   */
  private wrapWppLogger(session: string, baseLogger: any): any {
    return new Proxy(baseLogger, {
      get(target, prop, receiver) {
        if (prop === 'log') {
          return function logLimited(this: unknown, ...args: any[]) {
            const first = args[0];
            if (first && typeof first === 'object' && 'message' in first) {
              const msg = String((first as { message?: unknown }).message);
              if (msg.includes('Waiting for QRCode Scan')) {
                const key = String(
                  (first as { session?: string }).session ?? session
                );
                const n =
                  (CreateSessionUtil.qrWaitLogCountBySession.get(key) ?? 0) + 1;
                CreateSessionUtil.qrWaitLogCountBySession.set(key, n);
                if (n > CreateSessionUtil.MAX_QR_CONSOLE_LOGS) {
                  return undefined;
                }
              }
            }
            return Reflect.apply(
              target.log as (...a: any[]) => unknown,
              target,
              args
            );
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  /**
   * Elimina locks de perfil de Chromium que impiden un segundo lanzamiento.
   */
  private removeChromeProfileLocks(
    profileDir: string,
    logger: any,
    session: string
  ): void {
    const names = [
      'SingletonLock',
      'SingletonCookie',
      'SingletonSocket',
      path.join('Default', 'Preferences.lock'),
    ];
    for (const rel of names) {
      const full = path.join(profileDir, rel);
      try {
        if (fs.existsSync(full)) {
          fs.unlinkSync(full);
          logger.info(`[${session}] Lock eliminado: ${rel}`);
        }
      } catch {
        /* aún en uso */
      }
    }
  }

  /**
   * Windows: PowerShell + CIM (ruta vía base64 para evitar problemas de escape).
   */
  private async killChromeProcessesWindows(
    normalizedPath: string,
    sessionName: string,
    logger: any,
    session: string
  ): Promise<void> {
    const pathB64 = Buffer.from(normalizedPath, 'utf8').toString('base64');
    const nameB64 = Buffer.from(sessionName, 'utf8').toString('base64');
    const script =
      '$ErrorActionPreference = "SilentlyContinue"; ' +
      `$dir = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${pathB64}')); ` +
      `$name = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${nameB64}')); ` +
      'Get-CimInstance Win32_Process | Where-Object { ' +
      '$cmd = $_.CommandLine; if (-not $cmd) { return $false }; ' +
      "if ($_.Name -notmatch 'chrome|chromium|msedge') { return $false }; " +
      'if ($cmd.Contains($dir)) { return $true }; ' +
      'if (($cmd -like ("*" + $name + "*")) -and ($cmd -match "user-data-dir")) { return $true }; ' +
      'return $false } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }';

    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    try {
      await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
      logger.info(
        `[${session}] PowerShell: procesos Chrome/Chromium/Edge filtrados por userDataDir`
      );
    } catch (e) {
      logger.warn(
        `[${session}] PowerShell kill Chrome:`,
        (e as Error)?.message
      );
    }

    // Fallback: WMIC + líneas que contienen la ruta (extraer ProcessId numérico tras primera coma)
    try {
      const { stdout } = await execAsync(
        `wmic process where "name='chrome.exe' or name='chromium.exe' or name='msedge.exe'" get ProcessId,CommandLine /format:csv`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
      const pathFwd = normalizedPath.replace(/\\/g, '/');
      const pids = new Set<string>();
      for (const line of stdout.split(/\r?\n/)) {
        if (
          !line.includes(normalizedPath) &&
          !line.includes(pathFwd) &&
          !line.includes(sessionName)
        ) {
          continue;
        }
        // CSV WMIC: Nodo,ProcessId,CommandLine (CommandLine puede llevar comas)
        const m = line.match(/^[^,\r\n]+,\s*(\d+)\s*,/);
        if (m) pids.add(m[1]);
      }
      for (const pid of pids) {
        try {
          await execAsync(`taskkill /F /PID ${pid} 2>nul`);
        } catch {
          /* ok */
        }
      }
      if (pids.size > 0) {
        logger.info(`[${session}] WMIC fallback: taskkill ${pids.size} PID(s)`);
      }
    } catch {
      /* wmic no disponible */
    }
  }

  /**
   * Mata procesos de Chrome que estén usando un userDataDir específico.
   */
  private async killChromeProcessesForUserDataDir(
    userDataDir: string,
    logger: any,
    session: string
  ): Promise<void> {
    const pending = CreateSessionUtil.killChromeProcessesPromises.get(session);
    if (pending) {
      logger.info(
        `[${session}] Limpieza de Chrome en curso para esta sesión, esperando...`
      );
      await pending;
      return;
    }

    const run = (async () => {
      const normalizedPath = path.resolve(userDataDir);
      const sessionName = path.basename(normalizedPath);

      if (process.platform === 'win32') {
        try {
          await this.killChromeProcessesWindows(
            normalizedPath,
            sessionName,
            logger,
            session
          );
          await new Promise((r) => setTimeout(r, 2500));
          this.removeChromeProfileLocks(normalizedPath, logger, session);
          await new Promise((r) => setTimeout(r, 500));
          this.removeChromeProfileLocks(normalizedPath, logger, session);
        } catch (error) {
          logger.warn(
            `[${session}] Error en proceso de limpieza (Windows):`,
            error
          );
        }
      } else {
        try {
          // pkill -f usa regex: escapar la ruta para no matar procesos equivocados.
          const esc = normalizedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          await execAsync(`pkill -9 -f "${esc}" || true`, {
            maxBuffer: 10 * 1024 * 1024,
          });
          logger.info(`[${session}] pkill por userDataDir (Linux/Mac)`);
          await new Promise((resolve) => setTimeout(resolve, 2500));
          this.removeChromeProfileLocks(normalizedPath, logger, session);
          await new Promise((resolve) => setTimeout(resolve, 400));
          this.removeChromeProfileLocks(normalizedPath, logger, session);
        } catch (e) {
          /* Ignorar */
        }
      }
    })();

    CreateSessionUtil.killChromeProcessesPromises.set(session, run);
    try {
      await run;
    } finally {
      CreateSessionUtil.killChromeProcessesPromises.delete(session);
    }
  }

  startChatWootClient(client: any) {
    if (client.config.chatWoot && !client._chatWootClient)
      client._chatWootClient = new chatWootClient(
        client.config.chatWoot,
        client.session
      );
    return client._chatWootClient;
  }

  /** Cierra la sesión en memoria sin lanzar otro Chromium (evita procesos huérfanos). */
  private markSessionClosed(
    req: any,
    session: string,
    client: any,
    reason: string
  ): void {
    req.logger.warn(
      `[${session}] ${reason}. Sesión marcada CLOSED; reinicie manualmente con start-session si hace falta.`
    );
    if (client?._browserRestartTimer) {
      clearTimeout(
        client._browserRestartTimer as ReturnType<typeof setTimeout>
      );
      client._browserRestartTimer = undefined;
    }
    if (client) {
      client._restarting = false;
      client.status = 'CLOSED';
      client.qrcode = null;
      try {
        if (typeof client.close === 'function') {
          void client.close().catch(() => undefined);
        }
      } catch {
        /* noop */
      }
    }
    clientsArray[session] = undefined;
  }

  async createSessionUtil(
    req: any,
    clientsArray: any,
    session: string,
    res?: any
  ) {
    return this.runWithSessionQueue(session, () =>
      this.createSessionUtilCore(req, clientsArray, session, res)
    );
  }

  private async createSessionUtilCore(
    req: any,
    clientsArray: any,
    session: string,
    res?: any
  ) {
    try {
      let client = this.getClient(session) as any;

      const isLive =
        typeof client.sendText === 'function' &&
        typeof client.isConnected === 'function';
      // Stub solo si no es cliente real y no está a mitad de create() (INITIALIZING).
      const isStub = client && !isLive && client.status !== 'INITIALIZING';

      if (
        !isStub &&
        client.status != null &&
        client.status !== 'CLOSED' &&
        client.status !== 'INITIALIZING'
      ) {
        // Si está reiniciando (legado), esperar un momento
        if (client._restarting) {
          req.logger.info(
            `[${session}] Operación de sesión en curso, ignorando duplicado...`
          );
          return;
        }
        req.logger.info(
          `[${session}] Sesión ya en estado ${client.status}; no se reinicia.`
        );
        return;
      }

      if (client.status === 'INITIALIZING' && !isLive) {
        req.logger.info(
          `[${session}] create() en curso (INITIALIZING); no se lanza otro Chromium.`
        );
        return;
      }

      if (isStub) {
        req.logger.warn(
          `[${session}] Cliente stub detectado (sin sendText/isConnected). Recreando sesión.`
        );
        this.resetSessionQueue(session);
        clientsArray[session] = undefined;
        client = this.getClient(session) as any;
      }

      // Verificación preventiva: matar procesos colgados antes de crear sesión
      if (req.serverOptions.customUserDataDir) {
        const userDataDir = req.serverOptions.customUserDataDir + session;
        try {
          // Verificar si hay procesos bloqueando el userDataDir
          await this.killChromeProcessesForUserDataDir(
            userDataDir,
            req.logger,
            session
          );
        } catch (preventiveError) {
          req.logger.warn(
            `[${session}] Error en verificación preventiva:`,
            preventiveError
          );
        }
      }

      client.status = 'INITIALIZING';
      client._initAt = Date.now();
      client.config = req.body;
      this.rememberSessionRuntime(session, req);

      // Resetear flag de reinicio si existe
      client._restarting = false;

      const tokenStore = new Factory();
      const myTokenStore = tokenStore.createTokenStory(client);
      const tokenData = await myTokenStore.getToken(session);

      // we need this to update phone in config every time session starts, so we can ask for code for it again.
      myTokenStore.setToken(session, tokenData ?? {});

      this.startChatWootClient(client);

      if (req.serverOptions.customUserDataDir) {
        req.serverOptions.createOptions.puppeteerOptions = {
          userDataDir: req.serverOptions.customUserDataDir + session,
          // Aumentar timeout para evitar errores de ProtocolError
          protocolTimeout: 300000, // 5 minutos (300000ms) - tiempo suficiente para operaciones pesadas
          timeout: 300000, // Timeout general de Puppeteer
          // Opciones adicionales para mejorar estabilidad
          headless: process.env.WPP_HEADLESS === 'false' ? false : true,
          /**
           * Al cerrar SSH o el TTY de la sesión, el SO puede enviar SIGHUP; Puppeteer por defecto
           * cierra Chromium ante SIGHUP (parece "solo funciona mientras veo pm2 logs").
           */
          handleSIGHUP: false,
          handleSIGINT: true,
          handleSIGTERM: true,
          args: [
            ...(req.serverOptions.createOptions.browserArgs || []),
            '--disable-dev-shm-usage', // Evitar problemas de memoria compartida
            '--disable-gpu', // Deshabilitar GPU para reducir carga
            '--no-zygote', // Evitar problemas de procesos
            '--disable-setuid-sandbox', // Servidor Linux / contenedor sin sandbox de setuid
            // No usar --single-process: Chromium puede dejar el perfil bloqueado y dispara "already running"
          ],
        };
      } else {
        // Asegurar que siempre tengamos protocolTimeout configurado
        if (!req.serverOptions.createOptions.puppeteerOptions) {
          req.serverOptions.createOptions.puppeteerOptions = {};
        }
        const po = req.serverOptions.createOptions.puppeteerOptions as Record<
          string,
          unknown
        >;
        po.protocolTimeout = 300000;
        po.timeout = 300000;
        po.handleSIGHUP = false;
        po.handleSIGINT = true;
        po.handleSIGTERM = true;
      }

      if (req.serverOptions.customUserDataDir) {
        const profileDir = path.resolve(
          req.serverOptions.customUserDataDir + session
        );
        this.removeChromeProfileLocks(profileDir, req.logger, session);
      }

      const wppLogger =
        req.serverOptions.createOptions?.logger != null
          ? this.wrapWppLogger(
              session,
              req.serverOptions.createOptions.logger as any
            )
          : this.wrapWppLogger(session, defaultLogger);

      const wppClient = await create(
        Object.assign(
          {},
          { tokenStore: myTokenStore },
          req.serverOptions.createOptions,
          {
            /** Evita imprimir el QR ASCII completo en cada refresh (muy verboso). */
            logQR: false,
            logger: wppLogger,
            session: session,
            phoneNumber: client.config.phone ?? null,
            deviceName:
              client.config.phone == undefined // bug when using phone code this shouldn't be passed (https://github.com/wppconnect-team/wppconnect-server/issues/1687#issuecomment-2099357874)
                ? client.config?.deviceName ||
                  req.serverOptions.deviceName ||
                  'WppConnect'
                : undefined,
            poweredBy:
              client.config.phone == undefined // bug when using phone code this shouldn't be passed (https://github.com/wppconnect-team/wppconnect-server/issues/1687#issuecomment-2099357874)
                ? client.config?.poweredBy ||
                  req.serverOptions.poweredBy ||
                  'WPPConnect-Server'
                : undefined,
            catchLinkCode: (code: string) => {
              this.exportPhoneCode(req, client.config.phone, code, client, res);
            },
            catchQR: (
              base64Qr: any,
              asciiQR: any,
              attempt: any,
              urlCode: string
            ) => {
              this.exportQR(req, base64Qr, urlCode, client, res);
            },
            onLoadingScreen: (percent: string, message: string) => {
              req.logger.info(`[${session}] ${percent}% - ${message}`);
            },
            statusFind: (statusFind: string) => {
              try {
                eventEmitter.emit(
                  `status-${client.session}`,
                  client,
                  statusFind
                );
                if (
                  statusFind === 'autocloseCalled' ||
                  statusFind === 'desconnectedMobile'
                ) {
                  client.status = 'CLOSED';
                  client.qrcode = null;
                  client.close();
                  clientsArray[session] = undefined;
                }
                callWebHook(client, req, 'status-find', {
                  status: statusFind,
                  session: client.session,
                });
                req.logger.info(statusFind + '\n\n');
              } catch (error) {}
            },
            onBrowserClose: () => {
              this.markSessionClosed(
                req,
                session,
                client,
                'Browser cerrado inesperadamente'
              );
            },
          }
        )
      );

      client = clientsArray[session] = Object.assign(wppClient, client);
      await this.start(req, client);

      if (req.serverOptions.webhook.onParticipantsChanged) {
        await this.onParticipantsChanged(req, client);
      }

      if (req.serverOptions.webhook.onReactionMessage) {
        await this.onReactionMessage(client, req);
      }

      if (req.serverOptions.webhook.onRevokedMessage) {
        await this.onRevokedMessage(client, req);
      }

      if (req.serverOptions.webhook.onPollResponse) {
        await this.onPollResponse(client, req);
      }
      if (req.serverOptions.webhook.onLabelUpdated) {
        await this.onLabelUpdated(client, req);
      }
    } catch (e) {
      req.logger.error(`[${session}] Error al crear sesión:`, e);
      // Si falla la creación, intentar reiniciar después de un delay
      const errorMessage = (e as any)?.message || String(e);
      const errorName = (e as any)?.name || '';

      // Detectar errores de timeout de Puppeteer
      const isTimeoutError =
        errorName === 'ProtocolError' ||
        errorMessage.includes('timed out') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('Runtime.callFunctionOn timed out') ||
        errorMessage.includes('protocolTimeout');

      const isAutoClose = /auto\s*close/i.test(errorMessage);

      if (
        isTimeoutError ||
        isAutoClose ||
        errorMessage.includes('browser') ||
        errorMessage.includes('Failed to launch') ||
        errorMessage.includes('Code: 0') ||
        errorMessage.includes('already running') ||
        errorMessage.includes('Target closed') ||
        errorMessage.includes('Session closed') ||
        errorMessage.includes('SingletonLock') ||
        errorMessage.includes('socket hang up') ||
        errorMessage.includes('shared_memory_switch')
      ) {
        const client = this.getClient(session) as any;
        req.logger.warn(
          `[${session}] Error de navegador al crear sesión: ${errorMessage}`
        );

        if (
          errorMessage.includes('already running') ||
          errorMessage.includes('SingletonLock')
        ) {
          req.logger.warn(
            `[${session}] Lock o Chromium previo detectado; limpiando procesos del perfil...`
          );
          try {
            const userDataDir = req.serverOptions.customUserDataDir
              ? req.serverOptions.customUserDataDir + session
              : null;

            if (userDataDir) {
              await this.killChromeProcessesForUserDataDir(
                userDataDir,
                req.logger,
                session
              );
            }

            if (client?.page?.browser) {
              try {
                const browser = client.page.browser();
                if (browser?.isConnected()) {
                  await browser.close();
                }
              } catch (browserError) {
                req.logger.warn(
                  `[${session}] Error al cerrar browser:`,
                  browserError
                );
              }
            }
            if (client?.close) {
              try {
                await client.close();
              } catch (closeError) {
                req.logger.warn(
                  `[${session}] Error al cerrar cliente:`,
                  closeError
                );
              }
            }
          } catch (closeError) {
            req.logger.warn(
              `[${session}] Error al limpiar sesión:`,
              closeError
            );
          }
        }

        this.markSessionClosed(
          req,
          session,
          client,
          'No se relanza Chromium automáticamente tras el fallo'
        );
      } else {
        req.logger.error(`[${session}] Error no recuperable: ${errorMessage}`);
        clientsArray[session] = undefined;
      }
    }
  }

  async opendata(req: Request, session: string, res?: any) {
    await this.createSessionUtil(req, clientsArray, session, res);
  }

  exportPhoneCode(
    req: any,
    phone: any,
    phoneCode: any,
    client: WhatsAppServer,
    res?: any
  ) {
    eventEmitter.emit(`phoneCode-${client.session}`, phoneCode, client);

    Object.assign(client, {
      status: 'PHONECODE',
      phoneCode: phoneCode,
      phone: phone,
    });

    req.io.emit('phoneCode', {
      data: phoneCode,
      phone: phone,
      session: client.session,
    });

    callWebHook(client, req, 'phoneCode', {
      phoneCode: phoneCode,
      phone: phone,
      session: client.session,
    });

    if (res && !res._headerSent)
      res.status(200).json({
        status: 'phoneCode',
        phone: phone,
        phoneCode: phoneCode,
        session: client.session,
      });
  }

  exportQR(
    req: any,
    qrCode: any,
    urlCode: any,
    client: WhatsAppServer,
    res?: any
  ) {
    eventEmitter.emit(`qrcode-${client.session}`, qrCode, urlCode, client);
    Object.assign(client, {
      status: 'QRCODE',
      qrcode: qrCode,
      urlcode: urlCode,
    });

    qrCode = qrCode.replace('data:image/png;base64,', '');
    const imageBuffer = Buffer.from(qrCode, 'base64');

    req.io.emit('qrCode', {
      data: 'data:image/png;base64,' + imageBuffer.toString('base64'),
      session: client.session,
    });

    callWebHook(client, req, 'qrcode', {
      qrcode: qrCode,
      urlcode: urlCode,
      session: client.session,
    });
    if (res && !res._headerSent)
      res.status(200).json({
        status: 'qrcode',
        qrcode: qrCode,
        urlcode: urlCode,
        session: client.session,
      });
  }

  async onParticipantsChanged(req: any, client: any) {
    await client.isConnected();
    await client.onParticipantsChanged((message: any) => {
      callWebHook(client, req, 'onparticipantschanged', message);
    });
  }

  async start(req: Request, client: WhatsAppServer) {
    try {
      await client.isConnected();
      Object.assign(client, { status: 'CONNECTED', qrcode: null });

      req.logger.info(`Started Session: ${client.session}`);
      //callWebHook(client, req, 'session-logged', { status: 'CONNECTED'});
      req.io.emit('session-logged', { status: true, session: client.session });
      startHelper(client, req);
    } catch (error) {
      req.logger.error(error);
      req.io.emit('session-error', client.session);
    }

    await this.checkStateSession(client, req);
    await this.listenMessages(client, req);

    if (req.serverOptions.webhook.listenAcks) {
      await this.listenAcks(client, req);
    }

    if (req.serverOptions.webhook.onPresenceChanged) {
      await this.onPresenceChanged(client, req);
    }
  }

  async checkStateSession(client: WhatsAppServer, req: Request) {
    await client.onStateChange((state) => {
      req.logger.info(`State Change ${state}: ${client.session}`);
      const conflits = [SocketState.CONFLICT];

      if (conflits.includes(state)) {
        client.useHere();
      }

      const disconnectedStates = ['DISCONNECTED', 'TIMEOUT', 'OPEN_FAILURE'];
      if (disconnectedStates.includes(state)) {
        req.logger.warn(
          `[${client.session}] Estado ${state}; sesión cerrada sin relanzar Chromium.`
        );
        this.markSessionClosed(
          req,
          client.session,
          client,
          `Estado WhatsApp: ${state}`
        );
      }
    });
  }

  async listenMessages(client: WhatsAppServer, req: Request) {
    await client.onMessage(async (message: any) => {
      eventEmitter.emit(`mensagem-${client.session}`, client, message);
      callWebHook(client, req, 'onmessage', message);
      if (message.type === 'location')
        client.onLiveLocation(message.sender.id, (location) => {
          callWebHook(client, req, 'location', location);
        });
    });

    await client.onAnyMessage(async (message: any) => {
      message.session = client.session;

      if (message.type === 'sticker') {
        // Import dinámico: evita ciclo createSessionUtil ↔ sessionController al arrancar.
        const { download } = await import('../controller/sessionController');
        download(message, client, req.logger);
      }

      const isStatusMsg = isStatusOrBroadcastMessage(message);

      // Persistir todos los mensajes del hilo (entrada y salida), salvo status/broadcast.
      // callWebHook también llama autoDownload; el dedupe por messageId evita duplicados.
      if (
        !isStatusMsg &&
        (req.serverOptions?.websocket?.autoDownload ||
          req.serverOptions?.webhook?.autoDownload)
      ) {
        await autoDownload(client, req, message);
      }

      req.io.emit('received-message', { response: message });
      if (
        !isStatusMsg &&
        req.serverOptions.webhook.onSelfMessage &&
        message.fromMe
      ) {
        callWebHook(client, req, 'onselfmessage', message);
      }
    });

    await client.onIncomingCall(async (call) => {
      req.io.emit('incomingcall', call);
      callWebHook(client, req, 'incomingcall', call);
    });
  }

  async listenAcks(client: WhatsAppServer, req: Request) {
    await client.onAck(async (ack) => {
      req.io.emit('onack', ack);
      callWebHook(client, req, 'onack', ack);
    });
  }

  async onPresenceChanged(client: WhatsAppServer, req: Request) {
    await client.onPresenceChanged(async (presenceChangedEvent) => {
      req.io.emit('onpresencechanged', presenceChangedEvent);
      callWebHook(client, req, 'onpresencechanged', presenceChangedEvent);
    });
  }

  async onReactionMessage(client: WhatsAppServer, req: Request) {
    await client.isConnected();
    await client.onReactionMessage(async (reaction: any) => {
      req.io.emit('onreactionmessage', reaction);
      callWebHook(client, req, 'onreactionmessage', reaction);
    });
  }

  async onRevokedMessage(client: WhatsAppServer, req: Request) {
    await client.isConnected();
    await client.onRevokedMessage(async (response: any) => {
      req.io.emit('onrevokedmessage', response);
      callWebHook(client, req, 'onrevokedmessage', response);
    });
  }
  async onPollResponse(client: WhatsAppServer, req: Request) {
    await client.isConnected();
    await client.onPollResponse(async (response: any) => {
      req.io.emit('onpollresponse', response);
      callWebHook(client, req, 'onpollresponse', response);
    });
  }
  async onLabelUpdated(client: WhatsAppServer, req: Request) {
    await client.isConnected();
    await client.onUpdateLabel(async (response: any) => {
      req.io.emit('onupdatelabel', response);
      callWebHook(client, req, 'onupdatelabel', response);
    });
  }

  encodeFunction(data: any, webhook: any) {
    data.webhook = webhook;
    return JSON.stringify(data);
  }

  decodeFunction(text: any, client: any) {
    const object = JSON.parse(text);
    if (object.webhook && !client.webhook) client.webhook = object.webhook;
    delete object.webhook;
    return object;
  }

  getClient(session: any) {
    let client = clientsArray[session];

    if (!client)
      client = clientsArray[session] = {
        status: null,
        session: session,
      } as any;
    return client;
  }
}
