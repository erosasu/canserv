import cron from 'node-cron';
import OpenAI from 'openai';

import { config } from '../config.js';
import Orden from '../workOrder.js'; // modelo de órdenes activas

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Genera un mensaje breve para enviar a los empleados,
 * basado en las órdenes pendientes y materiales faltantes.
 */
async function generarResumen(ordenesPendientes, materialesFaltantes) {
  try {
    const ordenesTexto = ordenesPendientes
      .map((o) => `• ${o.no_Orden} - ${o.cliente} (${o.status})`)
      .join('\n');

    const materialesTexto = materialesFaltantes
      .map((m) => `• ${m.nombre} (${m.cantidad} ${m.unidad || ''})`)
      .join('\n');

    const userPrompt = `
      Genera un mensaje claro y motivador para los empleados de un taller de cancelería de aluminio.
      Incluye las órdenes pendientes y los materiales que deben adquirirse hoy.
      Sé breve, profesional y positivo. Usa emojis si ayuda a hacerlo más ameno.

      Órdenes pendientes:
      ${ordenesTexto || 'Ninguna'}

      Materiales por adquirir:
      ${materialesTexto || 'Todo en orden ✅'}
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente para la gestión de un taller de cancelería.',
        },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 200,
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('Error generando resumen con OpenAI:', err);
    return '⚠️ Error generando resumen automático.';
  }
}

/**
 * Función principal: obtiene los datos y envía los mensajes
 */
async function enviarRecordatorios(client) {
  try {
    console.log('🕗 Ejecutando rutina matutina...');

    const ordenesPendientes = await Orden.find({
      visibilidad: 1,
    }).populate('empleado_responsable');

    console.log(ordenesPendientes);

    for (const orden of ordenesPendientes) {
      // Para esta orden, juntar solo los materiales faltantes de la propia orden
      const materialesFaltantes =
        orden.listaMateriales?.notInInventory &&
        Array.isArray(orden.listaMateriales.notInInventory)
          ? orden.listaMateriales.notInInventory
          : [];

      // Generar mensaje solo para esta orden
      const mensaje = await generarResumen([orden], materialesFaltantes);

      // Enviar mensaje a cada empleado responsable de esta orden
      for (const empleado of orden.empleado_responsable) {
        try {
          //await client.sendText(empleado.celular, mensaje);
          console.log(
            `📨 Enviado a ${empleado.nombre} por orden ${orden.no_Orden}`
          );
        } catch (err) {
          console.error(`Error enviando a ${empleado.nombre}:`, err);
        }
      }
    }

    console.log('✅ Rutina matutina completada');
  } catch (err) {
    console.error('Error en enviarRecordatorios:', err);
  }
}

/**
 * Programa la ejecución automática con CRON (lunes a sábado a las 8:00 AM)
 */
export function startMorningRoutine(client) {
  // cron syntax: “segundo minuto hora día-mes mes día-semana”
  cron.schedule('30 8 * * 1-6', async () => {
    await enviarRecordatorios(client);
  });

  console.log('⏰ Rutina matutina programada: Lunes a Sábado, 8:00 AM');
}
