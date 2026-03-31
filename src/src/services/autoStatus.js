import fetch from 'node-fetch';
import OpenAI from 'openai';

import { config } from '../config.js';
import Producto from '../producto.js'; // tu modelo de productos

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getRandomProduct() {
  const count = await Producto.countDocuments({
    has_image: true,
    user_id: process.env.ACCOUNT_ID,
  });
  if (count === 0) return null;
  const random = Math.floor(Math.random() * count);
  return Producto.findOne({ has_image: true }).skip(random);
}

async function generateCaption(product) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // o "gpt-4o" si lo prefieres
      messages: [
        {
          role: 'system',
          content:
            'Eres un experto en marketing visual para cancelería de aluminio. Genera descripciones persuasivas y atractivas basadas en la imagen y los datos del producto.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Genera un texto atractivo para WhatsApp Status usando la siguiente información:
                - Producto: ${product.descripcion}
                - Color: ${product.color || 'Consulta opciones disponibles'}
                - Ubicación: ${product.ubicacion || 'Consulta disponibilidad'}
                
                El texto debe ser breve (máx 3 líneas), llamativo, invitar a preguntar por más modelos y usar emojis de hogar, ventana, puerta o baño según corresponda.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: product.imagePath, // debe ser una URL pública o un base64 con data URI
              },
            },
          ],
        },
      ],
      max_tokens: 120,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generando caption:', error);
    return `${product.descripcion} - Precio: $${product.precioUnitario}`;
  }
}
export async function startAutoStatuses(client) {
  async function postStatus() {
    try {
      const product = await getRandomProduct();

      if (!product) {
        console.log('No hay productos con imagen.');
        return;
      }

      const caption = await generateCaption(product);

      console.log(await client.sendImageStatus(product.imagePath, { caption }));
    } catch (err) {
      console.error('Error generando estado automático:', err);
    }
  }

  // Llamar cada 2 horas  horas * minutos * segundos * milisegundos
  setInterval(await postStatus, 2 * 60 * 60 * 1000);
  console.log('⏳ Publicador de estados iniciado (cada 30min)');
}
