import api from 'axios';
import dotenv from 'dotenv';
import { Request } from 'express';
import fs from 'fs';
import OpenAI from 'openai';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { convert } from '../mapper/index';
import Admin from '../src/admin.js';
import Cliente from '../src/chat.js';
import { generatePrompt } from '../src/prompt.js';
//import { startAutoStatuses } from '../src/services/autoStatus.js';
//import { registrarComprobantePago } from '../src/services/recibosService';
import { handleToolCalls } from '../src/services/toolService.js';
import { tools } from '../src/tools';
import { ServerOptions } from '../types/ServerOptions';
import processMediaContent from './processMedia';

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function contactToArray(
  number: any,
  isGroup?: boolean,
  isNewsletter?: boolean
) {
  const localArr: any = [];
  if (Array.isArray(number)) {
    for (let contact of number) {
      isGroup || isNewsletter
        ? (contact = contact.split('@')[0])
        : (contact = contact.split('@')[0]?.replace(/[^\w ]/g, ''));
      if (contact !== '')
        if (isGroup) (localArr as any).push(`${contact}@g.us`);
        else if (isNewsletter) (localArr as any).push(`${contact}@newsletter`);
        else (localArr as any).push(`${contact}@c.us`);
    }
  } else {
    const arrContacts = number.split(/\s*[,;]\s*/g);
    for (let contact of arrContacts) {
      isGroup || isNewsletter
        ? (contact = contact.split('@')[0])
        : (contact = contact.split('@')[0]?.replace(/[^\w ]/g, ''));
      if (contact !== '')
        if (isGroup) (localArr as any).push(`${contact}@g.us`);
        else if (isNewsletter) (localArr as any).push(`${contact}@newsletter`);
        else (localArr as any).push(`${contact}@c.us`);
    }
  }

  return localArr;
}

export function groupToArray(group: any) {
  const localArr: any = [];
  if (Array.isArray(group)) {
    for (let contact of group) {
      contact = contact.split('@')[0];
      if (contact !== '') (localArr as any).push(`${contact}@g.us`);
    }
  } else {
    const arrContacts = group.split(/\s*[,;]\s*/g);
    for (let contact of arrContacts) {
      contact = contact.split('@')[0];
      if (contact !== '') (localArr as any).push(`${contact}@g.us`);
    }
  }

  return localArr;
}

export function groupNameToArray(group: any) {
  const localArr: any = [];
  if (Array.isArray(group)) {
    for (const contact of group) {
      if (contact !== '') (localArr as any).push(`${contact}`);
    }
  } else {
    const arrContacts = group.split(/\s*[,;]\s*/g);
    for (const contact of arrContacts) {
      if (contact !== '') (localArr as any).push(`${contact}`);
    }
  }

  return localArr;
}

export async function callWebHook(
  client: any,
  req: Request,
  event: any,
  data: any
) {
  const webhook =
    client?.config.webhook || req.serverOptions.webhook.url || false;
  if (webhook) {
    if (
      req.serverOptions.webhook?.ignore &&
      (req.serverOptions.webhook.ignore.includes(event) ||
        req.serverOptions.webhook.ignore.includes(data?.from) ||
        req.serverOptions.webhook.ignore.includes(data?.type))
    )
      return;
    if (req.serverOptions.webhook.autoDownload)
      await autoDownload(client, req, data);
    try {
      const chatId =
        data.from ||
        data.chatId ||
        (data.chatId ? data.chatId._serialized : null);
      data = Object.assign({ event: event, session: client.session }, data);
      if (req.serverOptions.mapper.enable)
        data = await convert(req.serverOptions.mapper.prefix, data);
      api
        .post(webhook, data)
        .then(() => {
          try {
            const events = ['unreadmessages', 'onmessage'];
            if (events.includes(event) && req.serverOptions.webhook.readMessage)
              client.sendSeen(chatId);
          } catch (e) {}
        })
        .catch((e) => {
          req.logger.warn('Error calling Webhook.', e);
        });
    } catch (e) {
      req.logger.error(e);
    }
  }
}

function firstNonEmptyString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) return t;
    }
  }
  return undefined;
}

/**
 * Obtiene el nombre visible del mensaje (notifyName / pushName y equivalentes en WPPConnect).
 * Cubre variantes de mayúsculas y datos en `sender` o `_data`.
 */
function getDisplayNameFromMessage(message: any): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const sender = message.sender;
  const data = message._data ?? message;

  return firstNonEmptyString(
    message.notifyName,
    message.pushName,
    message.notifyname,
    message.pushname,
    data.notifyName,
    data.pushName,
    data.pushname,
    data.notifyname,
    sender?.pushName,
    sender?.pushname,
    sender?.name,
    sender?.shortName,
    sender?.verifiedName,
    message.contact?.name,
    message.contact?.pushname
  );
}

async function resolveDisplayName(
  client: any,
  message: any,
  chatId: string,
  isSystem: boolean
): Promise<string | undefined> {
  if (isSystem) return undefined;
  let name = getDisplayNameFromMessage(message);
  if (name) return name;
  if (typeof client?.getContact === 'function') {
    try {
      const contact = await client.getContact(chatId);
      name = firstNonEmptyString(
        contact?.pushname,
        contact?.pushName,
        contact?.name,
        contact?.shortName,
        contact?.verifiedName
      );
    } catch {
      /* ignore */
    }
  }
  return name;
}

/** URL o base64 de la miniatura de perfil que envía WPPConnect en el mensaje. */
function getProfileImageFromMessage(message: any): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const thumb =
    message.profilePicThumbObj ??
    message.profilePicThumObj ??
    message._data?.profilePicThumbObj ??
    message._data?.profilePicThumObj;
  const img = thumb?.img;
  if (typeof img === 'string') {
    const t = img.trim();
    if (t) return t;
  }
  return undefined;
}

/**
 * Downloads and uploads WhatsApp media to S3, generates an image description, and stores it in the thread.
 * Skips broadcast and group messages.
 * @param {any} client - WhatsApp client
 * @param {any} req - Request object with server options
 * @param {any} message - WhatsApp message object
 * @returns {Promise<string|null>} - Returns the S3 URL if uploaded, null otherwise
 */
let switch_autoanswer = false;
export async function autoDownload(
  client: any,
  req: any,
  message: any
): Promise<string | null> {
  try {
    // Filtros iniciales
    if (/broadcast|newsletter|@g.us|@broadcast/.test(message.from)) return null;
    const admin = await Admin.findOne({ _id: message.session });
    const SYSTEM_NUMBER = '521' + admin?.celular + '@c.us';

    // Comandos de control (Prender/Apagar)
    if (message.to === SYSTEM_NUMBER && message.from === SYSTEM_NUMBER) {
      if (message.body === 'Prender') {
        switch_autoanswer = true;
        return null;
      }
      if (message.body === 'Apagar') {
        switch_autoanswer = false;
        return null;
      }
    }

    const from = message.from;
    const account_id = client.session;
    const isSystem = from === SYSTEM_NUMBER;

    const searchField = isSystem ? message.to : message.from;
    let phone = '';
    if (message.sender?.formattedName) {
      phone = String(message.sender.formattedName).replace(/^\+|\s+/g, '');
    } else {
      phone = String(searchField).split('@')[0]?.replace(/[^\d]/g, '') || '';
    }

    const displayName = await resolveDisplayName(
      client,
      message,
      searchField,
      isSystem
    );
    const notifyName =
      displayName ||
      getDisplayNameFromMessage(message) ||
      message.sender?.name ||
      '';

    // `name` solo en $set: si también va en $setOnInsert, MongoDB lanza ConflictingUpdateOperators.
    const setDoc: Record<string, unknown> = { updatedAt: new Date() };
    if (displayName && !isSystem) setDoc.name = displayName;

    const profileImage = getProfileImageFromMessage(message);
    if (profileImage) setDoc.image = profileImage;

    // 1. Obtener o crear Cliente (Hilo)
    const thread = await Cliente.findOneAndUpdate(
      { from: searchField, account_id },
      {
        $setOnInsert: {
          phone,
          from: searchField,
          messages: [],
          createdAt: new Date(),
        },
        $set: setDoc,
      },
      { new: true, upsert: true }
    );

    // 2. Inicializar Prompt si es nuevo
    if (!thread.messages || thread.messages.length === 0) {
      thread.messages = [
        {
          role: 'system',
          content: (await generatePrompt(searchField, notifyName)).trim(),
          timeStamps: new Date(),
        },
      ];
    }

    // 3. PROCESAMIENTO DE MEDIA (Nueva función)
    if (message.type != 'chat') {
      await processMediaContent(client, message, thread, req, isSystem);
    }

    // 4. Procesamiento de Mensajes de Texto del Sistema
    if (isSystem && message.body && message.type == 'chat') {
      thread.messages.push({
        role: 'system',
        content: message.body,
        timeStamps: new Date(),
        messageId: message.id,
      });
      await thread.save();
    }

    // 5. Procesamiento de Mensajes de Usuario + IA
    if (
      typeof message.body === 'string' &&
      message.body.trim() !== '' &&
      !isSystem &&
      message.type == 'chat'
    ) {
      thread.messages.push({
        role: 'user',
        content: `${message.body.trim()} [Enviado: ${new Date().toLocaleString(
          'es-MX'
        )}]`,
        timeStamps: new Date(),
        messageId: message.id,
      });

      if (displayName && !thread.name) thread.name = displayName;
      await thread.save();

      // Llamada a OpenAI para respuesta
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-5-nano',
          messages: thread.messages,
          tools,
          tool_choice: 'auto',
        });

        const toolMessage = response.choices[0]?.message;

        if (toolMessage?.content && !toolMessage.tool_calls) {
          if (switch_autoanswer) {
            await client.startTyping(from);

            await client.sendText(from, toolMessage.content);
          } else {
            thread.next_message_sugested = toolMessage.content;
            await thread.save();
          }
        }

        if (toolMessage?.tool_calls) {
          await handleToolCalls(
            toolMessage.tool_calls,
            thread,
            from,
            notifyName,
            client,
            message,
            toolMessage,
            switch_autoanswer
          );
        }
      } catch (error) {
        console.error('OpenAI chat error:', error);
      }
    }

    return null;
  } catch (error) {
    console.error('Error in autoDownload:', error);
    return null;
  }
}

export async function startAllSessions(config: any, logger: any) {
  try {
    await api.post(
      `${config.host}:${config.port}/api/${config.secretKey}/start-all`
    );
  } catch (e) {
    logger.error(e);
  }
}

export async function startHelper(client: any, req: any) {
  // await startAutoStatuses(client);
  if (req.serverOptions.webhook.allUnreadOnStart) await sendUnread(client, req);

  if (req.serverOptions.archive.enable) await archive(client, req);
}

async function sendUnread(client: any, req: any) {
  req.logger.info(`${client.session} : Inicio enviar mensagens não lidas`);

  try {
    const chats = await client.getAllChatsWithMessages(true);

    if (chats && chats.length > 0) {
      for (let i = 0; i < chats.length; i++)
        for (let j = 0; j < chats[i].msgs.length; j++) {
          callWebHook(client, req, 'unreadmessages', chats[i].msgs[j]);
        }
    }

    req.logger.info(`${client.session} : Fim enviar mensagens não lidas`);
  } catch (ex) {
    req.logger.error(ex);
  }
}

async function archive(client: any, req: any) {
  async function sleep(time: number) {
    return new Promise((resolve) => setTimeout(resolve, time * 10));
  }

  req.logger.info(`${client.session} : Inicio arquivando chats`);

  try {
    let chats = await client.getAllChats();
    if (chats && Array.isArray(chats) && chats.length > 0) {
      chats = chats.filter((c) => !c.archive);
    }
    if (chats && Array.isArray(chats) && chats.length > 0) {
      for (let i = 0; i < chats.length; i++) {
        const date = new Date(chats[i].t * 1000);

        if (DaysBetween(date) > req.serverOptions.archive.daysToArchive) {
          await client.archiveChat(
            chats[i].id.id || chats[i].id._serialized,
            true
          );
          await sleep(
            Math.floor(Math.random() * req.serverOptions.archive.waitTime + 1)
          );
        }
      }
    }
    req.logger.info(`${client.session} : Fim arquivando chats`);
  } catch (ex) {
    req.logger.error(ex);
  }
}

function DaysBetween(StartDate: Date) {
  const endDate = new Date();
  // The number of milliseconds in all UTC days (no DST)
  const oneDay = 1000 * 60 * 60 * 24;

  // A day in UTC always lasts 24 hours (unlike in other time formats)
  const start = Date.UTC(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate()
  );
  const end = Date.UTC(
    StartDate.getFullYear(),
    StartDate.getMonth(),
    StartDate.getDate()
  );

  // so it's safe to divide by 24 hours
  return (start - end) / oneDay;
}

export function createFolders() {
  const __dirname = path.resolve(path.dirname(''));
  const dirFiles = path.resolve(__dirname, 'WhatsAppImages');
  if (!fs.existsSync(dirFiles)) {
    fs.mkdirSync(dirFiles);
  }

  const dirUpload = path.resolve(__dirname, 'uploads');
  if (!fs.existsSync(dirUpload)) {
    fs.mkdirSync(dirUpload);
  }
}

export function strToBool(s: string) {
  return /^(true|1)$/i.test(s);
}

export function getIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface: any = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (
        alias.family === 'IPv4' &&
        alias.address !== '127.0.0.1' &&
        !alias.internal
      )
        console.log(alias.address);
      return alias.address;
    }
  }
  return '0.0.0.0';
}

export function setMaxListners(serverOptions: ServerOptions) {
  if (serverOptions && Number.isInteger(serverOptions.maxListeners)) {
    process.setMaxListeners(serverOptions.maxListeners);
  }
}

export const unlinkAsync = promisify(fs.unlink);

export function createCatalogLink(session: any) {
  const [wid] = session.split('@');
  return `https://wa.me/c/${wid}`;
}
