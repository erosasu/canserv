// services/agendaService.ts
import crypto from 'crypto';

import { AgendaItem } from '../AgendaItem.js';

// Normaliza fecha: si viene solo fecha (YYYY-MM-DD), agrega 09:00 local -06:00
export function normalizeISO(fechaISO: string): string {
  // si ya trae "T", la respetamos
  if (fechaISO.includes('T')) return fechaISO;
  // agrega 09:00 hora CDMX por defecto
  return `${fechaISO}T09:00:00-06:00`;
}

// Crea hash para evitar duplicados (mismo día/hora + título + contacto)
export function buildUniqueHash(
  titulo: string,
  fechaISO: string,
  clienteContacto?: string
): string {
  const base = `${titulo.trim().toLowerCase()}|${new Date(
    fechaISO
  ).getTime()}|${(clienteContacto || '').trim()}`;
  return crypto.createHash('sha1').update(base).digest('hex');
}

// Alta principal basada en el modelo AgendaItem
export async function createAgendaItem({
  tipo,
  descripcion,
  titulo,
  fechaISO,
  ubicacion,
  clienteNombre,
  clienteContacto,
  material,
  cantidad,
  account_id,
  thread_id,
  fuenteMensajeTs,
}: any) {
  const fechaNorm = normalizeISO(fechaISO);
  const hashUnico = buildUniqueHash(titulo, fechaNorm, clienteContacto);

  // Checa duplicados por hashUnico y account_id (importante para evitar repetidos)
  const yaExiste = await AgendaItem.findOne({ hashUnico, account_id });
  if (yaExiste) return { ok: true, duplicated: true, item: yaExiste };

  // Crea el AgendaItem siguiendo el esquema del modelo
  const item = new AgendaItem({
    tipo,
    titulo,
    descripcion,
    fechaISO: new Date(fechaNorm),
    ubicacion,
    clienteNombre,
    clienteContacto,
    material,
    cantidad,
    account_id,
    thread_id,
    fuenteMensajeTs,
    hashUnico,
  });

  const saved = await item.save();
  console.log('pendiente creado', saved);
  return { ok: true, duplicated: false, item: saved };
}

/**
 * Formatea un número de teléfono al formato de WhatsApp (@c.us)
 * @param {string} numero - Número de teléfono (puede venir con o sin formato)
 * @returns {string} - Número formateado para WhatsApp
 */
function formatWhatsAppNumber(numero: string): string {
  if (!numero) return '';

  // Si ya tiene el formato @c.us, lo devolvemos tal cual
  if (numero.includes('@c.us')) return numero;

  // Limpiamos el número (quitamos espacios, guiones, paréntesis, etc.)
  let cleaned = numero.replace(/\D/g, '');

  // Si no empieza con 52 (código de México), lo agregamos
  if (!cleaned.startsWith('52')) {
    cleaned = '52' + cleaned;
  }

  return `${cleaned}@c.us`;
}

/**
 * Envía mensajes automáticos de recordatorio de pendientes próximos a vencer
 * @param {Object} client - Cliente de WhatsApp para enviar mensajes
 * @param {Object} options - Opciones de configuración
 * @param {number} options.horasAnticipacion - Horas antes de la fecha para enviar recordatorio (default: 24)
 * @param {string} options.account_id - ID de la cuenta (opcional, filtra por cuenta específica)
 * @returns {Promise<Object>} - Resultado con estadísticas de envío
 */
export async function enviarRecordatoriosPendientes(
  client: any,
  options: {
    horasAnticipacion?: number;
    account_id?: string;
  } = {}
): Promise<{
  totalPendientes: number;
  mensajesEnviados: number;
  errores: number;
  detalles: Array<{
    contacto: string;
    pendientes: number;
    exito: boolean;
    error?: string;
  }>;
}> {
  const { horasAnticipacion = 24, account_id } = options;

  try {
    // Calcular la fecha límite (ahora + horasAnticipacion)
    const ahora = new Date();
    const fechaLimite = new Date(
      ahora.getTime() + horasAnticipacion * 60 * 60 * 1000
    );

    // Construir query para buscar pendientes próximos a vencer
    const query: any = {
      fechaISO: {
        $gte: ahora, // Pendientes que aún no han vencido
        $lte: fechaLimite, // Y que vencen dentro de las próximas X horas
      },
      completado: { $ne: true }, // Solo pendientes no completados
      clienteContacto: { $exists: true, $ne: null }, // Que tengan contacto
    };

    // Filtrar por account_id si se proporciona
    if (account_id) {
      query.account_id = account_id;
    }

    // Buscar todos los pendientes que cumplen los criterios
    const pendientes = await AgendaItem.find(query).sort({ fechaISO: 1 });

    if (pendientes.length === 0) {
      console.log(
        '[enviarRecordatoriosPendientes] No hay pendientes próximos a vencer'
      );
      return {
        totalPendientes: 0,
        mensajesEnviados: 0,
        errores: 0,
        detalles: [],
      };
    }

    // Agrupar pendientes por clienteContacto
    const pendientesPorContacto = new Map<string, typeof pendientes>();

    for (const pendiente of pendientes) {
      const contacto = pendiente.clienteContacto;
      if (!contacto) continue;

      if (!pendientesPorContacto.has(contacto)) {
        pendientesPorContacto.set(contacto, []);
      }
      pendientesPorContacto.get(contacto)!.push(pendiente);
    }

    const detalles: Array<{
      contacto: string;
      pendientes: number;
      exito: boolean;
      error?: string;
    }> = [];

    let mensajesEnviados = 0;
    let errores = 0;

    // Enviar mensaje a cada contacto con sus pendientes
    for (const [contacto, listaPendientes] of pendientesPorContacto.entries()) {
      try {
        const numeroFormateado = formatWhatsAppNumber(contacto);

        if (!numeroFormateado) {
          console.warn(
            `[enviarRecordatoriosPendientes] Número inválido: ${contacto}`
          );
          errores++;
          detalles.push({
            contacto,
            pendientes: listaPendientes.length,
            exito: false,
            error: 'Número inválido',
          });
          continue;
        }

        // Construir mensaje con todos los pendientes del contacto
        let mensaje = `🔔 *Recordatorio de Pendientes*\n\n`;
        mensaje += `Tienes ${listaPendientes.length} pendiente${
          listaPendientes.length > 1 ? 's' : ''
        } próximo${listaPendientes.length > 1 ? 's' : ''} a vencer:\n\n`;

        for (const pendiente of listaPendientes) {
          const fechaFormateada = new Date(pendiente.fechaISO).toLocaleString(
            'es-MX',
            {
              timeZone: 'America/Mexico_City',
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }
          );

          mensaje += `📌 *${pendiente.titulo}*\n`;
          if (pendiente.descripcion) {
            mensaje += `   ${pendiente.descripcion}\n`;
          }
          mensaje += `   📅 ${fechaFormateada}\n`;

          if (pendiente.ubicacion) {
            mensaje += `   📍 ${pendiente.ubicacion}\n`;
          }

          if (pendiente.tipo === 'compra_material' && pendiente.material) {
            mensaje += `   🛒 Material: ${pendiente.material}`;
            if (pendiente.cantidad) {
              mensaje += ` (${pendiente.cantidad})`;
            }
            mensaje += `\n`;
          }

          mensaje += `\n`;
        }

        // Enviar mensaje
        await client.sendText('5213331184802', mensaje);

        mensajesEnviados++;
        detalles.push({
          contacto,
          pendientes: listaPendientes.length,
          exito: true,
        });

        console.log(
          `[enviarRecordatoriosPendientes] Recordatorio enviado a ${numeroFormateado} (${listaPendientes.length} pendientes)`
        );

        // Pequeña pausa entre mensajes para evitar rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error: any) {
        errores++;
        const errorMsg = error.message || error.toString();
        console.error(
          `[enviarRecordatoriosPendientes] Error enviando a ${contacto}:`,
          errorMsg
        );

        detalles.push({
          contacto,
          pendientes: listaPendientes.length,
          exito: false,
          error: errorMsg,
        });
      }
    }

    console.log(
      `[enviarRecordatoriosPendientes] Proceso completado: ${mensajesEnviados} enviados, ${errores} errores de ${pendientes.length} pendientes`
    );

    return {
      totalPendientes: pendientes.length,
      mensajesEnviados,
      errores,
      detalles,
    };
  } catch (error: any) {
    console.error('[enviarRecordatoriosPendientes] Error general:', error);
    throw error;
  }
}
