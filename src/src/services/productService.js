// services/productService.js
import axios from 'axios';

import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { validateToolArguments } from '../utils.js';

/**
 * Fetches product images based on a query.
 * @param {string} query - Product description
 * @returns {Promise<Array| string>} Array of images or error message
 */
export async function getProductImages(query) {
  console.log(query);
  try {
    const response = await axios.get(
      `https://api.cotizadoraluminio.mx/psi_no_auth/?descripcion=${encodeURIComponent(
        query
      )}`
    );
    console.log(response.data);
    const images = response.data.SimiProductImages || [];

    if (images.length === 0) {
      return `Podrías ser más específico en el tipo de ${query} para mostrarte imágenes.`;
    }
    return images;
  } catch (error) {
    throw new ApiError(
      `Failed to fetch product images: ${error.message}`,
      error.response?.status
    );
  }
}

/**
 * Generates a product quote.
 * @param {Object} toolArguments - Quote parameters
 * @param {Object} customerInfo - Customer information
 * @returns {Promise<Object|null>} Quote details or null on error
 */
export async function quoteMultipleProducts(toolArguments, customerInfo) {
  const requiredArgs = ['products'];
  validateToolArguments(toolArguments, requiredArgs);

  const { products, address } = toolArguments;
  const { contact, customerName, from } = customerInfo;

  // Codificamos el arreglo de productos como string JSON
  const productosParam = encodeURIComponent(JSON.stringify(products));
  const domicilioEncoded = encodeURIComponent(address);
  const clienteEncoded = encodeURIComponent(customerName);
  const encodedfrom = encodeURIComponent(from);

  try {
    const response = await axios.get(
      `${config.api.quoteBaseUrl}?productos=${productosParam}&address=${domicilioEncoded}&phone=${contact}&name=${clienteEncoded}&from=${encodedfrom}`
    );

    return response.data;
  } catch (error) {
    throw new ApiError(
      `Error al generar cotización múltiple: ${error.message}`,
      error.response?.status
    );
  }
}
