import api from 'axios';
import dotenv from 'dotenv';
import { Request } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { convert } from '../mapper/index';
import Cliente from '../src/chat.js';
import { ServerOptions } from '../types/ServerOptions';
//import { registrarComprobantePago } from '../src/services/recibosService';
import processMediaContent from './processMedia';

dotenv.config();

export type ChatIdentity = {
  session: string;
  /** JID canónico del hilo (@c.us / @lid) para ordenar chats. */
  from: string;
  /** Teléfono real en dígitos (vacío si solo hay LID sin mapeo). */
  phone: string;
  isSystem: boolean;
  isGroup: boolean;
};

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

/** Status / stories: from suele ser el propio número y to = status@broadcast. */
export function isStatusOrBroadcastMessage(message: any): boolean {
  if (!message) return false;
  const candidates = [
    message.from,
    message.to,
    message.chatId,
    message.chatId?._serialized,
    message.id?.remote,
    message.id?.participant,
  ]
    .filter(Boolean)
    .map(String);

  return candidates.some(
    (v) =>
      v === 'status@broadcast' ||
      v.includes('status@broadcast') ||
      /@broadcast$/i.test(v) ||
      /@newsletter$/i.test(v)
  );
}

function jidToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const obj = value as { _serialized?: unknown; user?: unknown };
    if (typeof obj._serialized === 'string') return obj._serialized.trim();
    if (typeof obj.user === 'string' && obj.user.trim()) {
      return obj.user.trim();
    }
  }
  return '';
}

/** Teléfono usable (10–15 dígitos). No usa el id numérico de un @lid. */
function normalizePhoneDigits(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return '';
}

function phoneFromJid(jid: string): string {
  if (!jid || jid.includes('@lid') || jid.includes('@g.us')) return '';
  if (!jid.includes('@c.us') && !jid.includes('@s.whatsapp.net')) return '';
  return normalizePhoneDigits(jid.split('@')[0]);
}

/**
 * Identidad del hilo para BD/webhook:
 * - `from`: JID del chat (@c.us / @lid)
 * - `phone`: número real (resuelve LID con getPnLidEntry cuando hace falta)
 */
export async function resolveChatIdentity(
  client: any,
  message: any
): Promise<ChatIdentity | null> {
  if (!message || isStatusOrBroadcastMessage(message)) return null;

  const session = String(client?.session || message.session || '').trim();
  if (!session) return null;

  const fromRaw = jidToString(message.from);
  const toRaw = jidToString(message.to);
  const chatIdRaw = jidToString(
    message.chatId?._serialized || message.chatId || message.key?.remoteJid
  );

  const isSystem = Boolean(
    message.fromMe || (fromRaw && session && fromRaw === session)
  );

  // Hilo del cliente: si lo envío yo, el chat es `to`; si me escriben, es `from`.
  const from = isSystem
    ? toRaw || chatIdRaw || fromRaw
    : fromRaw || chatIdRaw || toRaw;

  if (!from || /@g\.us$/i.test(from)) {
    return null;
  }

  // phone SOLO del cliente (mensaje entrante). En fromMe el sender es la sesión
  // y no debe grabarse el número propio en el hilo.
  let phone = '';
  if (!isSystem) {
    phone =
      phoneFromJid(from) ||
      phoneFromJid(jidToString(message.sender?.id)) ||
      normalizePhoneDigits(message.sender?.formattedName);

    // LID → número real vía mapeo de WhatsApp Web (from se mantiene como JID/@lid).
    if (!phone && typeof client?.getPnLidEntry === 'function') {
      try {
        const entry = await client.getPnLidEntry(from);
        const pn = jidToString(entry?.phoneNumber);
        phone = phoneFromJid(pn) || normalizePhoneDigits(pn.split('@')[0]);
      } catch {
        /* sin mapeo aún; se guarda el @lid y phone vacío */
      }
    }

    if (!phone && from.includes('@c.us')) {
      phone = phoneFromJid(from);
    }
  }

  return {
    session,
    from,
    phone,
    isSystem,
    isGroup: /@g\.us$/i.test(from),
  };
}

export async function callWebHook(
  client: any,
  req: Request,
  event: any,
  data: any
) {
  const webhook =
    client?.config?.webhook || req.serverOptions.webhook.url || false;
  if (!webhook) return;

  if (isStatusOrBroadcastMessage(data)) return;

  if (
    req.serverOptions.webhook?.ignore &&
    (req.serverOptions.webhook.ignore.includes(event) ||
      req.serverOptions.webhook.ignore.includes(data?.from) ||
      req.serverOptions.webhook.ignore.includes(data?.to) ||
      req.serverOptions.webhook.ignore.includes(data?.type))
  ) {
    return;
  }

  const messageEvents = ['unreadmessages', 'onmessage', 'onselfmessage'];
  let identity: ChatIdentity | null =
    (data?._chatIdentity as ChatIdentity) || null;

  // Persistir hilo antes del POST para que API_LosCuates encuentre session+from.
  // Si onAnyMessage ya corrió autoDownload, reutiliza _chatIdentity (sin duplicar).
  if (req.serverOptions.webhook.autoDownload && messageEvents.includes(event)) {
    identity = (await autoDownload(client, req, data)) || identity;
  } else if (!identity) {
    identity = await resolveChatIdentity(client, data);
  }

  try {
    const chatId =
      identity?.from ||
      data.from ||
      data.chatId ||
      (data.chatId ? data.chatId._serialized : null);

    const originalWhatsAppFields = {
      from: data.from,
      to: data.to,
      body: data.body,
      fromMe: data.fromMe,
      sender: data.sender,
      chatId: data.chatId,
      key: data.key,
      id: data.id,
      type: data.type,
      t: data.t,
      notifyName: data.notifyName,
      pushName: data.pushName,
    };

    data = Object.assign({ event, session: client.session }, data);
    if (req.serverOptions.mapper.enable) {
      data = await convert(req.serverOptions.mapper.prefix, data);
    }

    // Mapper tagone-* pisa `phone` con el user del JID (rompe @lid).
    // Dejamos from/phone canónicos para el registro en clientes.
    Object.assign(data, originalWhatsAppFields, {
      session: identity?.session || client.session,
      from: identity?.from || originalWhatsAppFields.from,
      phone: identity?.phone || '',
      chatFrom: identity?.from || originalWhatsAppFields.from,
    });
    delete data._chatIdentity;

    api
      .post(webhook, data)
      .then(() => {
        try {
          const events = ['unreadmessages', 'onmessage'];
          if (events.includes(event) && req.serverOptions.webhook.readMessage) {
            client.sendSeen(chatId);
          }
        } catch (e) {}
      })
      .catch((e) => {
        req.logger.warn('Error calling Webhook.', e);
      });
  } catch (e) {
    req.logger.error(e);
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

function getProfileImageFromMessage(message: any): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const thumb =
    message.profilePicThumbObj ??
    message.profilePicThumObj ??
    message.sender?.profilePicThumbObj ??
    message._data?.profilePicThumbObj ??
    message._data?.profilePicThumObj;
  const img = thumb?.img || thumb?.eurl;
  if (typeof img === 'string') {
    const t = img.trim();
    if (t) return t;
  }
  return undefined;
}

function messageIdKey(message: any): string {
  const id = message?.id;
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object') {
    return String(id._serialized || id.id || '');
  }
  return '';
}

function alreadyStored(thread: any, messageId: string): boolean {
  if (!messageId || !Array.isArray(thread?.messages)) return false;
  return thread.messages.some((m: any) => m?.messageId === messageId);
}

/** Evita carrera onMessage + onAnyMessage persistiendo el mismo mensaje dos veces. */
const autoDownloadInflight = new Map<string, Promise<ChatIdentity | null>>();

/**
 * Persiste el hilo en Mongo (clientes) por session + from, con phone real.
 * También procesa media. Devuelve la identidad para el webhook.
 */
export async function autoDownload(
  client: any,
  req: any,
  message: any
): Promise<ChatIdentity | null> {
  if (!message || isStatusOrBroadcastMessage(message)) return null;
  if (message._chatIdentity?.from) {
    return message._chatIdentity as ChatIdentity;
  }

  const inflightKey = `${client?.session || message.session || ''}:${
    messageIdKey(message) ||
    `${message.from}|${message.to}|${message.t}|${message.body || ''}`
  }`;

  const existing = autoDownloadInflight.get(inflightKey);
  if (existing) return existing;

  const work = autoDownloadImpl(client, req, message).finally(() => {
    autoDownloadInflight.delete(inflightKey);
  });
  autoDownloadInflight.set(inflightKey, work);
  return work;
}

async function autoDownloadImpl(
  client: any,
  req: any,
  message: any
): Promise<ChatIdentity | null> {
  try {
    const identity = await resolveChatIdentity(client, message);
    if (!identity || identity.isGroup) return null;

    message._chatIdentity = identity;
    message.session = identity.session;

    const { session, from, phone, isSystem } = identity;

    const displayName = await resolveDisplayName(
      client,
      message,
      from,
      isSystem
    );
    const profileImage = getProfileImageFromMessage(message);
    const msgId = messageIdKey(message);

    // Solo campos que se actualizan siempre; no repetir paths en $setOnInsert
    // (Mongo ConflictingUpdateOperators).
    // phone únicamente si fromMe === false (mensaje del cliente).
    const setDoc: Record<string, unknown> = { updatedAt: new Date() };
    if (displayName && !isSystem) setDoc.name = displayName;
    if (profileImage && !isSystem) setDoc.image = profileImage;
    if (phone && !isSystem) setDoc.phone = phone;

    // Buscar por from+session; si el hilo existía solo por phone (migración LID), reutilizarlo.
    let thread = await Cliente.findOne({ from, session });
    if (!thread && phone && !isSystem) {
      thread = await Cliente.findOne({ phone, session });
      if (thread && thread.from !== from) {
        thread.from = from;
      }
    }

    if (!thread) {
      thread = await Cliente.findOneAndUpdate(
        { from, session },
        {
          $setOnInsert: {
            session,
            from,
            messages: [],
            createdAt: new Date(),
            firstMessageTime: new Date(),
            // phone solo al crear si el mensaje es del cliente; si no, ''.
            ...(phone && !isSystem ? {} : { phone: '' }),
          },
          $set: setDoc,
        },
        { new: true, upsert: true }
      );
    } else {
      Object.assign(thread, setDoc);
      if (phone && !isSystem && !thread.phone) thread.phone = phone;
      await thread.save();
    }

    if (!thread.messages || thread.messages.length === 0) {
      thread.messages = [
        {
          role: 'system',
          content: 'Aqui comienza la conversacion',
          timeStamps: new Date(),
        },
      ];
      await thread.save();
    }

    if (msgId && alreadyStored(thread, msgId)) {
      return identity;
    }

    // Media (imagen/audio/doc): no grupos
    if (message.type && message.type !== 'chat') {
      await processMediaContent(client, message, thread, req, isSystem);
      return identity;
    }

    const body = typeof message.body === 'string' ? message.body.trim() : '';
    if (!body) return identity;

    const stamp = new Date().toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
    });

    if (isSystem) {
      thread.messages.push({
        role: 'system',
        content: `[${stamp}] ${body}`,
        timeStamps: new Date(),
        messageId: msgId || undefined,
      });
    } else {
      thread.messages.push({
        role: 'user',
        content: `${body} [Enviado: ${stamp}]`,
        timeStamps: new Date(),
        messageId: msgId || undefined,
      });
      if (displayName && !thread.name) thread.name = displayName;
    }

    thread.updatedAt = new Date();
    await thread.save();
    return identity;
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
