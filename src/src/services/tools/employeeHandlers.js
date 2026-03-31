import WorkOrder from '../../workOrder';

export const employeeHandlers = {
  async notifyResponsibleEmployee(args, { client, message, thread }) {
    try {
      if (!thread.work_orders || thread.work_orders.length === 0) {
        console.log(
          '[notifyResponsibleEmployee] No hay órdenes ligadas al cliente'
        );
        return;
      }
      // obtener la última orden del arreglo
      const ultimaOrdenId = thread.work_orders[thread.work_orders.length - 1];
      const orden = await WorkOrder.findById(ultimaOrdenId);
      if (!orden || !orden.empleado_responsable) {
        console.log(
          '[notifyResponsibleEmployee] No se encontró empleado responsable'
        );
        return;
      }

      const celular = orden.empleado_responsable[0].celular;
      let mensajeCliente = args?.mensaje || message?.body || '';
      // Limpiar el mensaje eliminando el número del cliente (13 dígitos consecutivos sin espacios)
      mensajeCliente = mensajeCliente.replace(/\d{13}/g, '').trim();

      if (!mensajeCliente) {
        console.log('[notifyResponsibleEmployee] Mensaje vacío, no se envía');
        return;
      }

      const texto = `📩 Nuevo mensaje de cliente ${thread.name}:\n"${mensajeCliente}"`;

      try {
        await client.sendText(celular, texto);
        console.log(
          `[notifyResponsibleEmployee] Notificación enviada a ${celular} (${
            orden.empleado_responsable[0]?.nombre || 'N/A'
          })`
        );
      } catch (sendErr) {
        const errorMsg = sendErr.message || sendErr.toString();
        if (errorMsg.includes('No LID for user') || errorMsg.includes('LID')) {
          console.warn(
            `[notifyResponsibleEmployee] No se pudo enviar a ${celular}: número no tiene LID válido en WhatsApp`
          );
        } else {
          throw sendErr; // Re-lanzar otros errores
        }
      }
    } catch (err) {
      console.error('[notifyResponsibleEmployee] Error:', err);
    }
  },
  async notifyActiveOrders(args, { client, message, thread }) {
    console.log('[notifyActiveOrders] Ejecutando para:', message.from);

    try {
      // Buscar órdenes activas de la cuenta y relacionadas al celular del empleado
      const ordenesActivas = await WorkOrder.find({
        account_id: thread.account_id,
        visibilidad: 1,
        'empleado_responsable.0.celular': thread.from.replace('@c.us', ''),
      });

      if (!ordenesActivas || ordenesActivas.length === 0) {
        console.log(
          '[notifyActiveOrders] No se encontraron órdenes activas para este empleado'
        );
        try {
          await client.sendText(
            message.from,
            '📭 Actualmente no tienes órdenes activas asignadas.'
          );
        } catch (sendErr) {
          const errorMsg = sendErr.message || sendErr.toString();
          if (
            errorMsg.includes('No LID for user') ||
            errorMsg.includes('LID')
          ) {
            console.warn(
              `[notifyActiveOrders] No se pudo enviar a ${message.from}: número no tiene LID válido`
            );
          } else {
            throw sendErr;
          }
        }
        return;
      }

      // Construir mensaje con todas las órdenes activas
      let texto = '📋 Tienes las siguientes órdenes activas:\n\n';
      ordenesActivas.forEach((orden, index) => {
        texto += `#${index + 1}\n🆔 Orden: ${orden._id}\n📍 Cliente: ${
          orden.cliente?.nombre || 'Sin nombre'
        }\n📌 Dirección: ${orden.cliente?.domicilio || 'No registrada'}\n\n`;
      });

      try {
        await client.sendText(message.from, texto);
        console.log(
          `[notifyActiveOrders] Enviadas ${ordenesActivas.length} órdenes a ${message.from}`
        );
      } catch (sendErr) {
        const errorMsg = sendErr.message || sendErr.toString();
        if (errorMsg.includes('No LID for user') || errorMsg.includes('LID')) {
          console.warn(
            `[notifyActiveOrders] No se pudo enviar a ${message.from}: número no tiene LID válido`
          );
        } else {
          throw sendErr;
        }
      }
    } catch (err) {
      console.error('[notifyActiveOrders] Error:', err);
    }
  },
  async notifyInvoiceRequest(args, { client, message, thread, enterprise }) {
    try {
      if (!thread.work_orders || thread.work_orders.length === 0) {
        console.log('[notifyInvoiceRequest] No hay órdenes ligadas al cliente');
        return;
      }

      // Obtener la última orden del arreglo
      const ultimaOrdenId = thread.work_orders[thread.work_orders.length - 1];
      const orden = await WorkOrder.findById(ultimaOrdenId)
        .populate('cliente') // si tienes referencia al cliente
        .populate('productos.producto') // si guardas los productos como refs
        .populate('empleado_responsable');

      if (!orden) {
        console.log('[notifyInvoiceRequest] No se encontró la orden');
        return;
      }

      const celular = `521${enterprise.accountant_whatsapp}`; // Teléfono del contador
      let mensajeCliente = args?.mensaje || message?.body || '';
      // Limpiar el mensaje eliminando el número del cliente (13 dígitos consecutivos sin espacios)
      mensajeCliente = mensajeCliente.replace(/\d{13}/g, '').trim();

      if (!mensajeCliente) {
        console.log('[notifyInvoiceRequest] Mensaje vacío, no se envía');
        return;
      }

      // Construir resumen de la orden
      const clienteNombre =
        orden.cliente?.nombre || thread.name || 'Cliente desconocido';
      const clienteRFC = orden.cliente?.rfc || 'N/A';
      const fecha = orden.fecha?.toLocaleDateString('es-MX') || 'Sin fecha';
      const total = orden.precioCliente
        ? `$${orden.precioCliente.toFixed(2)}`
        : 'N/A';

      const productos = (orden.productos || [])
        .map(
          (p) =>
            `- ${p.producto?.nombre || 'Producto'} (${p.cantidad} x $${
              p.precio_unitario?.toFixed(2) || '?'
            })`
        )
        .join('\n');

      const texto = `📑 *Solicitud de Factura*
              
          Cliente: ${clienteNombre}
          RFC: ${clienteRFC}
          Fecha de Orden: ${fecha}
          Total: ${total}
          
          🛒 Productos:
          ${productos || '- Sin productos registrados -'}
          
          📩 Mensaje del cliente:
          "${mensajeCliente}"
          
          🔗 Orden de trabajo: ${orden._id}
          Responsable: ${orden.empleado_responsable?.nombre || 'N/A'}
  `;

      try {
        await client.sendText(celular, texto);
        console.log(
          `[notifyInvoiceRequest] Factura solicitada - notificación enviada a ${celular}`
        );
      } catch (sendErr) {
        const errorMsg = sendErr.message || sendErr.toString();
        if (errorMsg.includes('No LID for user') || errorMsg.includes('LID')) {
          console.warn(
            `[notifyInvoiceRequest] No se pudo enviar a ${celular}: número no tiene LID válido en WhatsApp`
          );
        } else {
          throw sendErr;
        }
      }
    } catch (err) {
      console.error('[notifyInvoiceRequest] Error:', err);
    }
  },
};
