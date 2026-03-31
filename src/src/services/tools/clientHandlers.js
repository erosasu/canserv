// services/tools/clientHandlers.js
import { validateToolArguments } from '../../utils.js';
import WorkOrder from '../../workOrder';
import { createAgendaItem } from '../agendaService.ts';
//import { MaterialPendiente } from '../../models/MaterialPendiente.js';

export const clientHandlers = {
  async getClientAddress(args, { thread }) {
    validateToolArguments(args, ['address']);
    thread.address = args.address;
    await thread.save();
  },

  async getClientEmail(args, { thread }) {
    validateToolArguments(args, ['email']);
    thread.email = args.email;
    await thread.save();
  },

  async getClientName(args, { thread }) {
    validateToolArguments(args, ['name']);
    thread.name = args.name;
  },

  /*async agregarMaterialAListaDeCompra(args, { client, message, thread }) {
    validateToolArguments(args, ['material', 'cantidad', 'razon']);
    const nombreCliente = thread.name || message.notifyName || message.from;

    await MaterialPendiente.create({
      material: args.material,
      cantidad: args.cantidad,
      razon: args.razon,
      cliente: nombreCliente,
      from: message.from,
      creadoPor: 'bot',
      fecha: new Date(),
      estado: 'pendiente',
    });

    await client.sendText(
      process.env.SYSTEM_NUMBER,
      `🧾 Nuevo material agregado:\n📌 ${args.material}\n📦 Cantidad: ${args.cantidad}\n📋 Razón: ${args.razon}\n👤 Cliente: ${nombreCliente}`
    );

    await client.sendText(
      message.from,
      `¡Gracias ${nombreCliente}! He registrado el material "${args.material}" para su compra.`
    );
  },
*/
  async createAgendaItem(
    args,
    { client, thread, message, contact, customerName }
  ) {
    try {
      validateToolArguments(args, ['tipo', 'titulo', 'fechaISO']);
      const {
        tipo,
        titulo,
        descripcion,
        fechaISO,
        ubicacion,
        clienteNombre,
        clienteContacto,
        material,
        cantidad,
        fuenteMensajeTs,
      } = args;

      // Usar contact en lugar de thread.phone para ser consistente
      const contactoInfo = contact || thread.phone || 'No especificado';
      const descripcionCompleta = descripcion
        ? `${descripcion} Nombre: ${
            thread.name || 'No especificado'
          } contacto: ${contactoInfo}`
        : `Nombre: ${
            thread.name || 'No especificado'
          } contacto: ${contactoInfo}`;

      const res = await createAgendaItem({
        tipo,
        titulo,
        descripcion: descripcionCompleta,
        fechaISO,
        ubicacion,
        clienteNombre:
          clienteNombre || thread.name || customerName || 'No especificado',
        clienteContacto: clienteContacto || contact || 'No especificado',
        material,
        cantidad,
        account_id: client.session,
        thread_id: thread._id,
        fuenteMensajeTs:
          fuenteMensajeTs || message?.timestamp || new Date().toISOString(),
      });

      if (!res.duplicated && res.ok) {
        console.log('pendiente creado');

        // Usar message.from o contact en lugar de construir el número manualmente
        const recipient = message?.from || contact;
        if (!recipient) {
          console.warn(
            '[createAgendaItem] No se puede enviar confirmación: falta message.from o contact'
          );
          return;
        }

        try {
          const fechaFormateada = new Date(res.item.fechaISO).toLocaleString(
            'es-MX',
            { timeZone: 'America/Mexico_City' }
          );

          /* await client.sendText(
          recipient,
          `🗓️ ✅ Recordatorio creado: "${titulo}" — ${fechaFormateada}`
        );*/
          console.log(`[createAgendaItem] Confirmación enviada a ${recipient}`);
        } catch (sendErr) {
          // El error "No LID for user" puede ocurrir si el número no está en WhatsApp
          // No fallamos la creación del pendiente, solo registramos el error
          const errorMsg = sendErr.message || sendErr.toString();
          if (
            errorMsg.includes('No LID for user') ||
            errorMsg.includes('LID')
          ) {
            console.warn(
              `[createAgendaItem] No se pudo enviar confirmación a ${recipient}: número no tiene LID válido en WhatsApp`
            );
          } else {
            console.error(
              `[createAgendaItem] Error al enviar confirmación a ${recipient}:`,
              errorMsg
            );
          }
          // El pendiente ya fue creado exitosamente, así que no lanzamos el error
        }
      } else if (res.duplicated) {
        console.log(
          '[createAgendaItem] Pendiente duplicado, no se crea nuevo registro'
        );
      }
    } catch (err) {
      // Manejar errores de validación o base de datos
      console.error(
        '[createAgendaItem] Error al crear pendiente:',
        err.message || err
      );
      throw err; // Re-lanzar para que el llamador pueda manejarlo
    }
  },
};
