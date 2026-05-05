import { clientsArray } from './sessionUtil';

const browserAutoRestartDisabledSessions = new Set<string>();

export function disableBrowserAutoRestartForSession(
  session: string,
  logger?: any
): void {
  browserAutoRestartDisabledSessions.add(session);
  const c = clientsArray[session] as any;
  if (c?._browserRestartTimer) {
    clearTimeout(c._browserRestartTimer as ReturnType<typeof setTimeout>);
    c._browserRestartTimer = undefined;
  }
  if (c) c._restarting = false;
  logger?.info?.(
    `[${session}] Reinicio automático de Chromium deshabilitado hasta volver a abrir esta sesión explícitamente.`
  );
}

/** Llamado al iniciar sesión vía API: vuelven a estar permitidos los reinicios de Chromium. */
export function clearBrowserAutoRestartDisabledForSession(
  session: string
): void {
  browserAutoRestartDisabledSessions.delete(session);
}

function browserAutoRestartGloballyDisabled(): boolean {
  const v = String(process.env.WPP_BROWSER_AUTO_RESTART ?? '')
    .trim()
    .toLowerCase();
  return v === 'false' || v === '0' || v === 'off' || v === 'no';
}

export function shouldAllowBrowserAutoRestart(session: string): boolean {
  if (browserAutoRestartGloballyDisabled()) return false;
  return !browserAutoRestartDisabledSessions.has(session);
}

/** Activa con WPP_BROWSER_RESTART_ON_WA_STATES=true */
export function restartOnWaDisconnectedStates(): boolean {
  const v = String(process.env.WPP_BROWSER_RESTART_ON_WA_STATES ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}
