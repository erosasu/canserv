// services/toolService.js
import { ApiError, ValidationError } from '../errors.js';
import { formatContact, validateToolArguments } from '../utils.js';
import { clientHandlers } from './tools/clientHandlers.js';
import { employeeHandlers } from './tools/employeeHandlers.js';
import { productHandlers } from './tools/productHandlers.js';
import { systemHandlers } from './tools/systemHandlers.js';

const executingTools = new Set();

/**
 * Función helper para ejecutar operaciones con timeout y retry
 */
async function executeWithTimeoutRetry(operation, options = {}) {
  const {
    timeout = 120000, // 2 minutos
    maxRetries = 2,
    retryDelay = 3000,
    operationName = 'Operación',
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Crear promesa con timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${operationName} timeout después de ${timeout}ms`));
        }, timeout);
      });

      // Ejecutar operación con timeout
      const result = await Promise.race([operation(), timeoutPromise]);
      return result;
    } catch (error) {
      lastError = error;
      const errorMessage = error?.message || String(error);
      const isTimeoutError =
        errorMessage.includes('timeout') ||
        errorMessage.includes('timed out') ||
        error?.name === 'ProtocolError' ||
        errorMessage.includes('Runtime.callFunctionOn timed out');

      if (isTimeoutError && attempt < maxRetries) {
        console.warn(
          `[${operationName}] Intento ${attempt}/${maxRetries} falló por timeout, reintentando en ${retryDelay}ms...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelay * attempt)
        );
        continue;
      }

      // Si no es timeout o ya agotamos reintentos, lanzar error
      throw error;
    }
  }

  throw lastError;
}

async function safeSendText(client, to, text, thread) {
  const lastBotMsg = [...(thread.messages || [])]
    .reverse()
    .find((m) => m.role !== 'user');
  if (lastBotMsg && lastBotMsg.content === text) {
    console.log('[safeSendText] Mensaje duplicado detectado, no se enviará.');
    return;
  }

  try {
    // Usar wrapper con timeout y retry para operaciones de envío
    await executeWithTimeoutRetry(
      async () => {
        await client.sendText(to, text);
      },
      {
        timeout: 60000, // 1 minuto para envío de mensajes
        maxRetries: 2,
        retryDelay: 2000,
        operationName: `safeSendText a ${to}`,
      }
    );
  } catch (err) {
    // Manejar errores comunes de WhatsApp
    const errorMessage = err.message || err.toString();
    const errorName = err.name || '';

    // Errores que no requieren acción (solo loguear)
    if (
      errorMessage.includes('No LID for user') ||
      errorMessage.includes('LID')
    ) {
      console.warn(
        `[safeSendText] No se pudo enviar a ${to}: número no tiene LID válido en WhatsApp`
      );
      return; // No lanzar error para estos casos
    }

    // Errores de timeout después de todos los reintentos
    if (errorName === 'ProtocolError' || errorMessage.includes('timeout')) {
      console.error(
        `[safeSendText] Timeout al enviar mensaje a ${to} después de múltiples intentos:`,
        errorMessage
      );
      // No lanzar error para evitar que falle toda la operación
      return;
    }

    // Otros errores
    console.error(
      `[safeSendText] Error al enviar mensaje a ${to}:`,
      errorMessage
    );
    // No lanzar el error para evitar que falle toda la operación del tool
  }
}

async function handleToolCall(
  toolCall,
  thread,
  client,
  message,
  contact,
  customerName,
  switch_autoanswer
) {
  const toolCallId = toolCall.id;
  const toolFunctionName = toolCall.function?.name;
  let toolArguments = {};

  try {
    toolArguments =
      typeof toolCall.function?.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function?.arguments || {};
  } catch (err) {
    throw new ValidationError(
      `Invalid arguments for ${toolFunctionName}: ${err.message}`
    );
  }

  const key = toolFunctionName + JSON.stringify(toolArguments);

  // Evitar ejecuciones duplicadas
  if (executingTools.has(toolCallId)) {
    console.log(`[ToolService] ToolCall ${toolCallId} ya en ejecución`);
    return;
  }
  if (!thread.lastExecuted) thread.lastExecuted = [];
  if (thread.lastExecuted.includes(key)) {
    console.log(`[ToolService] ToolCall repetido (${key}), ignorado`);
    return;
  }

  executingTools.add(toolCallId);

  try {
    const handlers = {
      ...productHandlers,
      ...clientHandlers,
      ...systemHandlers,
      ...employeeHandlers,
    };

    if (handlers[toolFunctionName]) {
      await handlers[toolFunctionName](toolArguments, {
        client,
        message,
        thread,
        contact,
        customerName,
        safeSendText,
        switch_autoanswer,
      });
    } else {
      console.log(`[ToolService] Función ${toolFunctionName} no implementada`);
    }

    // Guardar historial de ejecución
    thread.lastExecuted.push(key);
    if (thread.lastExecuted.length > 20) thread.lastExecuted.shift();
  } catch (err) {
    console.error(`[ToolService] Error ejecutando ${toolFunctionName}:`, err);
  } finally {
    executingTools.delete(toolCallId);
  }
}

export async function handleToolCalls(
  toolCalls,
  thread,
  contact,
  customerName,
  client,
  message,
  toolMessage,
  switch_autoanswer
) {
  if (!toolCalls || toolCalls.length === 0) {
    console.log('[ToolService] No tool calls identificados');
    return;
  }

  // Filtrar duplicados en la misma tanda
  const uniqueToolCalls = [];
  const seen = new Set();
  for (const toolCall of toolCalls) {
    const key =
      toolCall.function.name + JSON.stringify(toolCall.function.arguments);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueToolCalls.push(toolCall);
    }
  }

  for (const toolCall of uniqueToolCalls) {
    await handleToolCall(
      toolCall,
      thread,
      client,
      message,
      contact,
      customerName,
      switch_autoanswer
    );
  }

  await thread.save();
}
