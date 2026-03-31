import OpenAI from 'openai';

import Cliente from './chat.js'; // Updated to use clientes model
import { config } from './config.js';
import { ApiError } from './errors.js';
import { generatePrompt } from './prompt.js';
import { startAutoReminders } from './services/autoReminders.js';
import { startAutoStatuses } from './services/autoStatus.js';
import { handleToolCalls } from './services/toolService.js';
import { tools } from './tools.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_NUMBER = config.systemNumber || '5213314243625@c.us';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the WhatsApp client and handles incoming messages.
 * @param {Object} client - WhatsApp client
 */
export default async function start(client) {
  // Iniciar recordatorios automáticos de pendientes
  // Se ejecuta cada 6 horas para pendientes que vencen en las próximas 24 horas
  startAutoReminders(client, {
    horasAnticipacion: 24, // Recordar pendientes que vencen en las próximas 24 horas
    account_id: '6490fc33b844a5d0f55ab865', // Usar el mismo account_id del sistema
    ejecutarInmediatamente: true, // Ejecutar una vez al iniciar
  });

  client.onMessage(async (message) => {
    try {
      let thread;

      // Early exit for broadcast or group messages
      if (/broadcast|newsletter|@g.us/.test(message.from)) {
        console.log('Skipping broadcast or group message from:', message.from);
        return;
      }
      startAutoStatuses(client);
      client.sendTextStatus(`Bootstrap primary color: #0275d8`, {
        backgroundColor: '#0275d8',
        font: 2,
      });
      // Handle quoted messages

      // Find existing thread by from
      thread = await Cliente.findOne({
        from: message.from,
        account_id: '6490fc33b844a5d0f55ab865',
      });

      // Create new thread if none exists
      if (!thread) {
        thread = await Cliente.create({
          phone: message.from.replace('521', '').replace('@c.us', ''), // Extract phone number
          from: message.from,
          name: message.notifyName || 'Unknown',

          email: '',
          address: '',
          rfc: '',
          messages: [
            {
              role: 'system',
              content: await generatePrompt(
                message.notifyName || 'Unknown',
                message.from
              ),
            },
          ],
          quotes: [],
          work_orders: [],
          firstMessageTime: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else if (!thread.messages || thread.messages.length === 0) {
        // Initialize messages with system prompt if null or empty
        thread.messages = [
          {
            role: 'system',
            content: await generatePrompt(
              message.notifyName || thread.name || 'Unknown',
              message.from
            ),
          },
        ];
        thread.firstMessageTime = thread.firstMessageTime || new Date();
        thread.updatedAt = new Date();
        await thread.save();
      }

      let isImage = false;
      if (
        message.type?.startsWith('image') ||
        message.type?.startsWith('video')
      ) {
        isImage = true;
      }

      // Add user message
      if (
        typeof message.body === 'string' &&
        message.body.trim() !== '' &&
        !['image', 'video'].includes(message.type)
      ) {
        thread.messages.push({
          role: 'user',
          content: message.body.trim(),
        });
        thread.updatedAt = new Date();
      }

      if (isImage) {
        await delay(15000); // Wait for autoDownload updates
        thread = await Cliente.findOne({ from: message.from });
      }

      let toolMessage = null;

      // Generate response with OpenAI for non-group messages
      if (!/@g.us/.test(message.from)) {
        try {
          const response = await openai.chat.completions.create({
            model: config.openai.model,
            messages: thread.messages,
            tools,
            tool_choice: 'auto',
          });

          if (!response.choices?.[0]?.message) {
            throw new ApiError('Invalid OpenAI response', 500);
          }

          toolMessage = response.choices[0].message;
          toolMessage.content = toolMessage.content || 'Function call executed';
        } catch (error) {
          console.error('Error calling OpenAI API:', error);
          throw new ApiError('Failed to generate response', 500);
        }
      }
      console.log(message.type);
      // Forward user message to system

      // Send response if no tool calls
      if (toolMessage && !toolMessage.tool_calls) {
        await client.sendText(
          SYSTEM_NUMBER,
          `{"from":"AIassistant", to:${message.from} name: ${message.notifyName} "body":"${toolMessage.content}"}`
        );

        thread.updatedAt = new Date();
      }

      // Handle tool calls
      if (toolMessage?.tool_calls) {
        await handleToolCalls(
          toolMessage.tool_calls,
          thread,
          message.from,
          message.notifyName || thread.name,
          client,
          message,
          toolMessage
        );
      } else {
        await thread.save();
      }
    } catch (error) {
      console.error('Error processing message:', error);
      // Optionally notify the user or system admin
    }
  });
}
