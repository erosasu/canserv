// services/autoReminders.js
import cron from 'node-cron';

import { enviarRecordatoriosPendientes } from './agendaService.ts';

/**
 * Función principal: envía recordatorios de pendientes próximos a vencer
 * @param {Object} client - Cliente de WhatsApp
 * @param {Object} options - Opciones de configuración
 */
async function ejecutarRecordatorios(client, options = {}) {
  try {
    console.log('🔔 Ejecutando recordatorios automáticos de pendientes...');

    const resultado = await enviarRecordatoriosPendientes(client, {
      horasAnticipacion: options.horasAnticipacion || 24, // Por defecto 24 horas
      account_id: options.account_id,
    });

    console.log(
      `✅ Recordatorios completados: ${resultado.mensajesEnviados} enviados, ${resultado.errores} errores`
    );

    return resultado;
  } catch (err) {
    console.error('❌ Error en ejecutarRecordatorios:', err);
    throw err;
  }
}

/**
 * Inicia el sistema de recordatorios automáticos
 * Ejecuta recordatorios cada 6 horas para pendientes que vencen en las próximas 24 horas
 * @param {Object} client - Cliente de WhatsApp
 * @param {Object} options - Opciones de configuración
 * @param {number} options.horasAnticipacion - Horas antes de la fecha para enviar recordatorio (default: 24)
 * @param {string} options.account_id - ID de la cuenta (opcional)
 * @param {string} options.cronSchedule - Expresión cron personalizada (default: cada 6 horas)
 */
export function startAutoReminders(client, options = {}) {
  // Por defecto: ejecutar cada 6 horas (a las 00:00, 06:00, 12:00, 18:00)
  // cron syntax: "segundo minuto hora día-mes mes día-semana"
  const cronSchedule = options.cronSchedule || '0 0,6,12,18 * * *';

  // Ejecutar inmediatamente al iniciar (opcional)
  if (options.ejecutarInmediatamente !== false) {
    ejecutarRecordatorios(client, options).catch((err) => {
      console.error('Error en ejecución inicial de recordatorios:', err);
    });
  }

  // Programar ejecuciones periódicas
  cron.schedule(cronSchedule, async () => {
    await ejecutarRecordatorios(client, options);
  });

  console.log(`⏰ Recordatorios automáticos programados: ${cronSchedule}`);
  console.log(`   Horas de anticipación: ${options.horasAnticipacion || 24}`);
  if (options.account_id) {
    console.log(`   Account ID: ${options.account_id}`);
  }
}

/**
 * Función para ejecutar recordatorios manualmente (útil para testing)
 * @param {Object} client - Cliente de WhatsApp
 * @param {Object} options - Opciones de configuración
 */
export async function ejecutarRecordatoriosManual(client, options = {}) {
  return await ejecutarRecordatorios(client, options);
}
