/*
 * Copyright 2021 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { NextFunction, Request, Response } from 'express';

import { contactToArray } from '../util/functions';

function clientLooksLive(client: any): boolean {
  return Boolean(
    client &&
      typeof client.isConnected === 'function' &&
      typeof client.sendText === 'function'
  );
}

export default async function statusConnection(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!clientLooksLive(req.client)) {
      return res.status(404).json({
        response: null,
        status: 'Disconnected',
        message:
          'A sessão do WhatsApp não está ativa (cliente inválido o stub en memoria). Reinicia con start-session.',
      });
    }

    await req.client.isConnected();

    const numbers: any = [];
    const localArr = contactToArray(
      req.body.phone || [],
      req.body.isGroup,
      req.body.isNewsletter
    );
    let index = 0;
    for (const contact of localArr) {
      if (req.body.isGroup || req.body.isNewsletter) {
        localArr[index] = contact;
      } else if (numbers.indexOf(contact) < 0) {
        let profile: any = null;
        let checkError: any = null;
        try {
          profile = await req.client.checkNumberStatus(contact);
        } catch (error) {
          checkError = error;
          req.logger?.warn?.(
            `[statusConnection] checkNumberStatus falló para ${contact}: ${
              (error as Error)?.message || error
            }. Se intentará enviar con el id original.`
          );
        }

        if (checkError) {
          // WhatsApp Web a veces falla checkNumberStatus (LID / API) aunque el número exista.
          // No bloquear el envío: dejar el contacto normalizado (@c.us) y seguir.
          localArr[index] = contact;
        } else if (!profile?.numberExists) {
          const num = (contact as any).split('@')[0];
          return res.status(400).json({
            response: null,
            status: 'Connected',
            message: `O número ${num} não existe.`,
          });
        } else {
          const serialized = profile?.id?._serialized || profile?.id || contact;
          if ((numbers as any).indexOf(serialized) < 0) {
            (numbers as any).push(serialized);
          }
          (localArr as any)[index] = serialized;
        }
      }
      index++;
    }
    req.body.phone = localArr;
    next();
  } catch (error) {
    req.logger.error(error);
    return res.status(404).json({
      response: null,
      status: 'Disconnected',
      message: 'A sessão do WhatsApp não está ativa.',
    });
  }
}
