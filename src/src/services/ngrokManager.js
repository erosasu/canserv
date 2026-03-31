// services/ngrokManager.js
/**
 * Servicio de gestión automática de túneles ngrok
 *
 * Este servicio monitorea el estado del túnel de ngrok y lo reinicia automáticamente
 * cuando detecta que ha fallado. También actualiza el webhook URL en la base de datos.
 *
 * Variables de entorno opcionales:
 * - ENABLE_NGROK_MONITORING: 'true' o 'false' (default: 'true')
 * - NGROK_CHECK_INTERVAL: Intervalo de verificación en ms (default: 300000 = 5 min)
 * - NGROK_WEBHOOK_SYNC_INTERVAL_MS: Sincroniza el webhook en BD con la URL de ngrok (default: 3600000 = 1 h)
 * - NGROK_RETRY_DELAY: Tiempo entre reintentos en ms (default: 30000 = 30 seg)
 * - NGROK_MAX_RETRIES: Número máximo de reintentos (default: 3)
 * - PORT: Puerto local del servidor (default: 21465)
 */
import axios from 'axios';
import { exec, spawn } from 'child_process';
import mongoose from 'mongoose';
import os from 'os';
import { promisify } from 'util';

import config from '../../config';
import redisClient from '../../util/db/redis/db';
import {
  defaultFileTokenStoreOptions,
  FileTokenStore,
} from '../../util/tokenStore/FileTokenStore/FileTokenStore';
import Token from '../../util/tokenStore/model/token.js';
import admin from '../admin.js';

const execAsync = promisify(exec);

/**
 * Prefijo de claves Redis (misma lógica que redisTokenStory).
 */
function getRedisPrefix() {
  let prefix = config.db?.redisPrefix || '';
  if (prefix === 'docker') {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
      const iface = interfaces[devName];
      if (!iface) continue;
      for (let i = 0; i < iface.length; i++) {
        const alias = iface[i];
        if (
          alias.family === 'IPv4' &&
          alias.address !== '127.0.0.1' &&
          !alias.internal
        ) {
          return alias.address;
        }
      }
    }
    return '0.0.0.0';
  }
  return prefix;
}

function applyWebhookToTokenData(tokenData, newUrl) {
  tokenData.webhook = newUrl;
  if (tokenData.config == null) return;
  if (typeof tokenData.config === 'string') {
    try {
      const c = JSON.parse(tokenData.config);
      c.webhook = newUrl;
      tokenData.config = JSON.stringify(c);
    } catch {
      /* ignorar JSON inválido */
    }
  } else if (typeof tokenData.config === 'object') {
    tokenData.config.webhook = newUrl;
  }
}

/**
 * Servicio para gestionar túneles de ngrok automáticamente
 * Monitorea el estado del túnel y lo reinicia cuando falla
 */
class NgrokManager {
  constructor(options = {}) {
    this.localPort = options.localPort || process.env.PORT || 21465;
    this.ngrokApiUrl = 'http://127.0.0.1:4040/api';
    this.checkInterval = options.checkInterval || 5 * 60 * 1000; // 5 minutos por defecto
    const defaultWebhookSync = 60 * 60 * 1000; // 1 hora
    const envSync = process.env.NGROK_WEBHOOK_SYNC_INTERVAL_MS;
    this.webhookSyncInterval =
      options.webhookSyncInterval ??
      (envSync != null && envSync !== ''
        ? Math.max(60000, parseInt(envSync, 10) || defaultWebhookSync)
        : defaultWebhookSync);
    this.retryDelay = options.retryDelay || 30 * 1000; // 30 segundos entre reintentos
    this.maxRetries = options.maxRetries || 3;
    this.isMonitoring = false;
    this.currentTunnelUrl = null;
    this.monitorTimer = null;
    this.webhookSyncTimer = null;
    this.ngrokProcess = null;
  }

  /**
   * Obtiene el estado actual del túnel de ngrok
   */
  async getTunnelStatus() {
    try {
      const response = await axios.get(`${this.ngrokApiUrl}/tunnels`, {
        timeout: 5000,
      });

      if (
        response.data &&
        response.data.tunnels &&
        response.data.tunnels.length > 0
      ) {
        const tunnel =
          response.data.tunnels.find(
            (t) => t.config.addr === `http://localhost:${this.localPort}`
          ) || response.data.tunnels[0];

        return {
          active: true,
          url: tunnel.public_url,
          proto: tunnel.proto,
        };
      }

      return { active: false };
    } catch (error) {
      // Si no puede conectar a la API de ngrok, asumimos que no está corriendo
      return { active: false, error: error.message };
    }
  }

  /**
   * Inicia ngrok usando la línea de comandos
   */
  async startNgrok() {
    try {
      console.log('[NgrokManager] Iniciando ngrok...');

      // Verificar si ngrok ya está corriendo
      const status = await this.getTunnelStatus();
      if (status.active) {
        console.log('[NgrokManager] Ngrok ya está corriendo:', status.url);
        this.currentTunnelUrl = status.url;
        return status.url;
      }

      // Verificar que ngrok esté instalado
      try {
        await execAsync('ngrok version');
      } catch (error) {
        throw new Error(
          'ngrok no está instalado o no está en el PATH. Por favor instala ngrok primero.'
        );
      }

      // Iniciar ngrok usando spawn (más confiable que exec)
      console.log(
        `[NgrokManager] Iniciando ngrok para puerto ${this.localPort}...`
      );

      const isWindows = process.platform === 'win32';
      const ngrokProcess = spawn('ngrok', ['http', this.localPort.toString()], {
        detached: !isWindows,
        stdio: 'ignore',
        shell: isWindows,
      });

      // Manejar errores del proceso
      ngrokProcess.on('error', (error) => {
        console.error(
          '[NgrokManager] Error al iniciar proceso ngrok:',
          error.message
        );
        throw new Error(`No se pudo iniciar ngrok: ${error.message}`);
      });

      // Guardar referencia al proceso
      this.ngrokProcess = ngrokProcess;

      // En sistemas Unix, desasociar el proceso
      if (!isWindows) {
        ngrokProcess.unref();
      }

      // Esperar a que ngrok se inicie y la API esté disponible
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Obtener el nuevo URL
      let retries = 0;
      while (retries < 10) {
        const newStatus = await this.getTunnelStatus();
        if (newStatus.active) {
          this.currentTunnelUrl = newStatus.url;
          console.log(
            '[NgrokManager] Ngrok iniciado exitosamente:',
            newStatus.url
          );
          return newStatus.url;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        retries++;
      }

      throw new Error(
        'No se pudo obtener el URL de ngrok después de iniciarlo'
      );
    } catch (error) {
      console.error('[NgrokManager] Error al iniciar ngrok:', error.message);
      throw error;
    }
  }

  /**
   * Detiene todos los túneles de ngrok
   */
  async stopNgrok() {
    try {
      console.log('[NgrokManager] Deteniendo túneles de ngrok...');

      // Usar la API de ngrok para detener túneles
      try {
        const tunnels = await axios.get(`${this.ngrokApiUrl}/tunnels`);
        if (tunnels.data && tunnels.data.tunnels) {
          for (const tunnel of tunnels.data.tunnels) {
            try {
              await axios.delete(`${this.ngrokApiUrl}/tunnels/${tunnel.name}`);
            } catch (err) {
              // Ignorar errores al eliminar túneles individuales
            }
          }
        }
      } catch (apiError) {
        // Si la API no está disponible, intentar matar el proceso
        try {
          if (this.ngrokProcess) {
            this.ngrokProcess.kill();
            this.ngrokProcess = null;
          }

          if (process.platform === 'win32') {
            try {
              await execAsync('taskkill /F /IM ngrok.exe /T');
            } catch (e) {
              // Ignorar si no hay procesos
            }
          } else {
            try {
              await execAsync('pkill ngrok');
            } catch (e) {
              // Ignorar si no hay procesos
            }
          }
        } catch (killError) {
          console.warn(
            '[NgrokManager] No se pudo detener ngrok:',
            killError.message
          );
        }
      }

      this.currentTunnelUrl = null;
      console.log('[NgrokManager] Ngrok detenido');
    } catch (error) {
      console.error('[NgrokManager] Error al detener ngrok:', error.message);
    }
  }

  /**
   * Reinicia ngrok (detiene y vuelve a iniciar)
   */
  async restartNgrok() {
    try {
      console.log('[NgrokManager] Reiniciando ngrok...');
      await this.stopNgrok();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const newUrl = await this.startNgrok();
      return newUrl;
    } catch (error) {
      console.error('[NgrokManager] Error al reiniciar ngrok:', error.message);
      throw error;
    }
  }

  /**
   * Actualiza el webhook URL en el almacén de tokens (MongoDB, archivos o Redis)
   * según config.tokenStoreType. El modelo Mongoose Token solo existe si es 'mongodb'.
   */
  async updateWebhookInDatabase(newUrl) {
    console.log(
      '[NgrokManager] Actualizando webhook en base de datos:',
      newUrl
    );
    try {
      await admin.updateOne(
        { _id: new mongoose.Types.ObjectId('6490fc33b844a5d0f55ab865') },
        { $set: { server_whatsapp: newUrl } }
      );
      console.log(
        '[NgrokManager] server_whatsapp actualizado correctamente en la colección usuarios'
      );
    } catch (error) {
      console.error(
        '[NgrokManager] Error al actualizar webhook en base de datos:',
        error.message
      );
      throw error;
    }
  }

  /**
   * Verifica el estado del túnel y lo reinicia si es necesario
   */
  async checkAndRestoreTunnel() {
    try {
      const status = await this.getTunnelStatus();

      if (!status.active) {
        console.warn('[NgrokManager] Túnel de ngrok inactivo, reiniciando...');

        let retries = 0;
        let success = false;

        while (retries < this.maxRetries && !success) {
          try {
            const newUrl = await this.restartNgrok();
            await this.updateWebhookInDatabase(newUrl);
            this.currentTunnelUrl = newUrl;
            success = true;
            console.log(
              '[NgrokManager] Túnel restaurado exitosamente:',
              newUrl
            );
          } catch (error) {
            retries++;
            console.error(
              `[NgrokManager] Intento ${retries} fallido:`,
              error.message
            );
            if (retries < this.maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, this.retryDelay)
              );
            }
          }
        }

        if (!success) {
          console.error(
            '[NgrokManager] No se pudo restaurar el túnel después de varios intentos'
          );
        }
      } else {
        // Verificar si el URL cambió
        if (this.currentTunnelUrl && status.url !== this.currentTunnelUrl) {
          console.log('[NgrokManager] URL de ngrok cambió:', status.url);
          await this.updateWebhookInDatabase(status.url);
          this.currentTunnelUrl = status.url;
        } else if (!this.currentTunnelUrl) {
          // Primera vez que detectamos el túnel
          this.currentTunnelUrl = status.url;
          await this.updateWebhookInDatabase(status.url);
        }
      }
    } catch (error) {
      console.error(
        '[NgrokManager] Error en verificación de túnel:',
        error.message
      );
    }
  }

  /**
   * Obtiene la URL pública actual de ngrok y persiste el webhook en BD (mínimo 1 vez por hora por defecto).
   */
  async scheduledWebhookSync() {
    try {
      const status = await this.getTunnelStatus();
      if (!status.active || !status.url) {
        return;
      }
      await this.updateWebhookInDatabase(status.url);
      this.currentTunnelUrl = status.url;
    } catch (error) {
      console.error(
        '[NgrokManager] Error en sincronización programada de webhook:',
        error.message
      );
    }
  }

  /**
   * Inicia el monitoreo automático del túnel de ngrok
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.log('[NgrokManager] El monitoreo ya está activo');
      return;
    }

    this.isMonitoring = true;
    console.log(
      `[NgrokManager] Monitoreo iniciado (verificando cada ${
        this.checkInterval / 1000 / 60
      } minutos)`
    );
    console.log(
      `[NgrokManager] Sincronización de webhook en BD cada ${
        this.webhookSyncInterval / 1000 / 60
      } minutos`
    );

    // Verificación inicial (con manejo de errores)
    this.checkAndRestoreTunnel().catch((error) => {
      console.error(
        '[NgrokManager] Error en verificación inicial:',
        error.message
      );
      // Continuar con el monitoreo aunque falle la verificación inicial
    });

    // Primera sincronización de webhook poco después del arranque (URL dinámica de ngrok)
    setTimeout(() => {
      this.scheduledWebhookSync().catch((error) => {
        console.error(
          '[NgrokManager] Error en sincronización inicial de webhook:',
          error.message
        );
      });
    }, 15000);

    // Verificaciones periódicas del túnel
    this.monitorTimer = setInterval(() => {
      this.checkAndRestoreTunnel().catch((error) => {
        console.error(
          '[NgrokManager] Error en verificación periódica:',
          error.message
        );
      });
    }, this.checkInterval);

    // Garantizar que el webhook en BD se actualice al menos con la periodicidad configurada (por defecto 1 h)
    this.webhookSyncTimer = setInterval(() => {
      this.scheduledWebhookSync().catch((error) => {
        console.error(
          '[NgrokManager] Error en sincronización periódica de webhook:',
          error.message
        );
      });
    }, this.webhookSyncInterval);
  }

  /**
   * Detiene el monitoreo automático
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    if (this.webhookSyncTimer) {
      clearInterval(this.webhookSyncTimer);
      this.webhookSyncTimer = null;
    }
    console.log('[NgrokManager] Monitoreo detenido');
  }

  /**
   * Obtiene el URL actual del túnel
   */
  getCurrentUrl() {
    return this.currentTunnelUrl;
  }
}

// Exportar instancia singleton
let ngrokManagerInstance = null;

/**
 * Obtiene o crea la instancia del NgrokManager
 */
export function getNgrokManager(options = {}) {
  if (!ngrokManagerInstance) {
    ngrokManagerInstance = new NgrokManager(options);
  }
  return ngrokManagerInstance;
}

/**
 * Inicia el monitoreo automático de ngrok
 */
export function startNgrokMonitoring(options = {}) {
  const manager = getNgrokManager(options);
  manager.startMonitoring();
  return manager;
}

export default NgrokManager;
