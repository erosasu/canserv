// services/tools/systemHandlers.js
import { config } from '../../config.js';

export const systemHandlers = {
  async sendAccountInfo(args, { client, message, thread, enterprise }) {
    const results = `Banco ${enterprise.bank_name}
    Nombre: ${enterprise.razon_social}
    CLABE: ${enterprise.clave_interban}
    Tarjeta: ${enterprise.card_number_deposit}`;
    const lastBotMsg = [...(thread.messages || [])]
      .reverse()
      .find((m) => m.role !== 'user');
    if (lastBotMsg && lastBotMsg.content === results) {
      console.log('[sendAccountInfo] Mensaje duplicado detectado, no se envía');
      return;
    }
    try {
      await client.sendText(message.from, results);
    } catch (err) {
      const errorMsg = err.message || err.toString();
      if (errorMsg.includes('No LID for user') || errorMsg.includes('LID')) {
        console.warn(
          `[sendAccountInfo] No se pudo enviar a ${message.from}: número no tiene LID válido`
        );
      } else {
        console.error(`[sendAccountInfo] Error al enviar mensaje:`, errorMsg);
        throw err;
      }
    }
  },

  async sendAddress(args, { client, message, enterprise, thread }) {
    try {
      if (thread.type_user === 'cliente potencial') {
        await client.sendLocation(
          message.from,
          String(enterprise.latitud),
          String(enterprise.longitud),
          'México'
        );
      }
    } catch (err) {
      console.error('[sendAddress] Error al enviar la dirección:', err);
      throw err;
    }
  },

  async sendCFDI(args, { client, message, enterprise }) {
    try {
      // Enviar archivo a WhatsApp
      if (message.from != '5213318453480@c.us') {
        await client.sendFile(
          message.from,
          `${enterprise.cdfi_pdf}`, // sin encabezados tipo "data:..."
          { caption: 'CFDI Canceles de Jalisco' }
        );
      }
      console.log('[sendCFDI] CFDI enviado correctamente');
    } catch (error) {
      console.error('[sendCFDI] Error al enviar CFDI:', error);
    }
  },

  async sendReviewLink(args, { client, message, enterprise }) {
    try {
      await client.sendText(
        message.from,
        `Ahora que hemos concluido con tu instalación, nos ayudarías bastante calificando la atención que le brindamos y productos instalados en el siguiente link: ${enterprise.feedback_google}`
      );
    } catch (err) {
      const errorMsg = err.message || err.toString();
      if (errorMsg.includes('No LID for user') || errorMsg.includes('LID')) {
        console.warn(
          `[sendReviewLink] No se pudo enviar a ${message.from}: número no tiene LID válido`
        );
      } else {
        console.error(`[sendReviewLink] Error al enviar mensaje:`, errorMsg);
        throw err;
      }
    }
  },
};
