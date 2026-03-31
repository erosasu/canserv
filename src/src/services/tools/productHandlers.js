const { getProductImages } = require('../productService.js');
const { formatContact, validateToolArguments } = require('../../utils.js');
const axios = require('axios');
const config = require('../../config.js');
const { ApiError } = require('../../errors.js');
const logger = require('../../../util/logger.js'); // Optional: Adjust path to your logger (e.g., winston)

// Validate arguments for getProductImages
const validateGetProductImagesArgs = (args) => {
  if (
    !args ||
    !args.query ||
    typeof args.query !== 'string' ||
    args.query.trim() === ''
  ) {
    throw new Error(
      'El argumento "query" es requerido y debe ser una cadena no vacía'
    );
  }
};

// Validate arguments for quoteMultipleProducts
const validateQuoteMultipleProductsArgs = (args) => {
  if (
    !args ||
    !args.products ||
    !Array.isArray(args.products) ||
    args.products.length === 0
  ) {
    throw new Error(
      'El argumento "products" es requerido y debe ser un arreglo no vacío'
    );
  }
  if (args.address && typeof args.address !== 'string') {
    throw new Error('El argumento "address" debe ser una cadena');
  }
};

// Product handlers
export const productHandlers = {
  async getProductImages(args, { client, message, thread }) {
    console.log('entro al enviar imagenes');
    try {
      // 1. Validate arguments
      validateToolArguments(args, ['query']); // Keep existing validation
      validateGetProductImagesArgs(args);
      await client.startTyping(thread.from);
      // 2. Retrieve product images
      const results = await getProductImages(args.query);
      if (!Array.isArray(results) || results.length === 0) {
        console.log(
          `No se encontraron imágenes para la consulta: ${args.query}`
        );
        try {
        } catch (sendErr) {
          const errorMsg = sendErr.message || sendErr.toString();
          if (
            errorMsg.includes('No LID for user') ||
            errorMsg.includes('LID')
          ) {
            console.warn(
              `[getProductImages] No se pudo enviar a ${message.from}: número no tiene LID válido`
            );
          } else {
            console.error(
              `[getProductImages] Error al enviar mensaje:`,
              errorMsg
            );
          }
        }
        return null;
      }

      // 3. Send each image
      for (const image of results) {
        if (thread.images_sent.includes(image.imagePath)) {
          console.log(
            `La imagen ${image.imagePath} ya fue enviada anteriormente.`
          );
          continue; // Continúa con la siguiente imagen si esta ya fue enviada
        }
        try {
          await client.sendImage(
            message.from,
            image.imagePath,
            image.descripcion,
            image.descripcion
          );
          thread.images_sent.push(image.imagePath);
          console.log(`Imagen enviada a ${message.from}: ${image.imagePath}`);
        } catch (error) {
          const errorMsg = error.message || error.toString();
          if (
            errorMsg.includes('No LID for user') ||
            errorMsg.includes('LID')
          ) {
            console.warn(
              `[getProductImages] No se pudo enviar imagen a ${message.from}: número no tiene LID válido`
            );
          } else {
            console.log(
              `Error al enviar imagen a ${message.from}: ${errorMsg}`
            );
          }
          // Continúa con la siguiente imagen en caso de error
        }
      }

      return { success: true, count: results.length };
    } catch (error) {
      console.log(`Error en getProductImages: ${error.message}`);
      //await client.sendText(message.from, 'Lo siento, hubo un error al obtener las imágenes.');
      throw error;
    }
  },

  async quoteMultipleProducts(
    args,
    { client, thread, contact, customerName, switch_autoanswer }
  ) {
    try {
      // 1. Validación de argumentos
      validateToolArguments(args, ['products']);
      validateQuoteMultipleProductsArgs(args);

      const { products, address = '' } = args;

      // 2. Codificar parámetros
      const productosParam = encodeURIComponent(JSON.stringify(products));
      const domicilioEncoded = encodeURIComponent(
        address || thread.address || ''
      );
      const clienteEncoded = encodeURIComponent(customerName || '');
      const encodedFrom = encodeURIComponent(thread.from || '');

      // 3. Llamada a la API
      let quotation;
      try {
        const response = await axios.get(
          `http://localhost:3002/autocotizar/${thread.account_id}?productos=${productosParam}&address=${domicilioEncoded}&phone=${contact}&name=${clienteEncoded}&from=${encodedFrom}`
        );
        console.log(response.data);
        quotation = response.data;
      } catch (error) {
        throw new ApiError(
          `Error al generar cotización múltiple: ${error.message}`,
          error.response?.status
        );
      }

      // 4. Responder automáticamente si está activado
      if (quotation?.precioCliente) {
        try {
          await client.startTyping(thread.from);

          console.log(
            `Mensaje de cotización enviado a ${thread.from}: $${quotation.precioCliente}`
          );
        } catch (error) {
          const errorMsg = error.message || error.toString();
          if (
            errorMsg.includes('No LID for user') ||
            errorMsg.includes('LID')
          ) {
            console.warn(
              `[quoteMultipleProducts] No se pudo enviar a ${thread.from}: número no tiene LID válido`
            );
          } else {
            console.log(
              `Error al enviar mensaje de cotización a ${thread.from}: ${errorMsg}`
            );
          }
        }
      }

      // 5. Retornar la cotización
      return null;
    } catch (error) {
      const status = error.response?.status || 500;
      console.log(`Error en quoteMultipleProducts: ${error.message}`, {
        status,
      });
      /* await client.sendText(
        thread.from,
        "Lo siento, hubo un error al generar la cotización."
      );*/
      throw new ApiError(
        `Error al generar cotización múltiple: ${error.message}`,
        status
      );
    }
  },
};
