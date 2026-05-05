import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import mimetypes from 'mime-types';
import OpenAI, { toFile } from 'openai';

import config from '../config';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Función auxiliar para transcribir con OpenAI
 */
async function transcribeWith(file: any) {
  return openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: file,
    language: 'es',
  });
}

/**
 * Transcodifica Buffer de audio a MP3 usando FFmpeg
 */
async function transcodeToMp3(
  buffer: Buffer,
  originalExt: string
): Promise<{ buf: Buffer; mime: string; filename: string }> {
  const ffmpegPath = (await import('ffmpeg-static')).default as string;
  const { mkdtemp, writeFile, readFile, unlink } = await import('fs/promises');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { spawn } = await import('child_process');

  const tmp = await mkdtemp(join(tmpdir(), 'oga2mp3-'));
  const inPath = join(tmp, `in.${originalExt}`);
  const outPath = join(tmp, 'out.mp3');

  await writeFile(inPath, buffer);

  await new Promise<void>((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      '-y',
      '-i',
      inPath,
      '-acodec',
      'libmp3lame',
      '-ar',
      '44100',
      '-b:a',
      '128k',
      outPath,
    ]);
    let stderr = '';
    ff.stderr.on('data', (d) => (stderr += d.toString()));
    ff.on('close', (code) => {
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exit ${code}: ${stderr}`));
    });
  });

  const mp3Buf = await readFile(outPath);

  // Limpieza de temporales
  await Promise.all([unlink(inPath), unlink(outPath)]).catch(() => {});

  return {
    buf: mp3Buf,
    mime: 'audio/mpeg',
    filename: `audio_${Date.now()}.mp3`,
  };
}

export default async function processMediaContent(
  client: any,
  message: any,
  thread: any,
  req: any,
  fromSessionOwner: boolean
): Promise<string | null> {
  const isImage =
    message.type?.startsWith('image') || message.mimetype?.startsWith('image/');
  const isVideo =
    message.type?.startsWith('video') || message.mimetype?.startsWith('video/');
  const isAudio =
    message.type?.startsWith('audio') || message.mimetype?.startsWith('audio/');
  const isDocument =
    message.type === 'document' || message.mimetype === 'application/pdf';

  if (!isImage && !isVideo && !isAudio && !isDocument) return null;

  try {
    // Intentar obtener el buffer del media
    // Para mensajes entrantes, usar decryptFile
    // Para mensajes salientes sin mediaUrl, usar downloadMedia como fallback
    let buffer: Buffer;

    try {
      // Intentar decryptFile primero (funciona para mensajes entrantes)
      buffer = await client.decryptFile(message);
    } catch (decryptError: any) {
      // Si decryptFile falla por falta de mediaUrl (mensajes salientes de API),
      // intentar downloadMedia como fallback
      if (
        decryptError.message?.includes('mediaUrl') ||
        decryptError.message?.includes('critical data')
      ) {
        console.warn(
          'decryptFile falló (mensaje sin mediaUrl), intentando downloadMedia como fallback...'
        );
        try {
          buffer = await client.downloadMedia(message);
        } catch (downloadError) {
          console.error(
            'Error descargando media (downloadMedia):',
            downloadError
          );
          throw downloadError;
        }
      } else {
        // Si el error es por otra razón, relanzarlo
        throw decryptError;
      }
    }

    let s3Url: string | null = null;
    let mediaDescription: string | null = null;

    // --- 1. Upload a S3 ---
    if (
      req.serverOptions?.webhook?.uploadS3 ||
      req.serverOptions?.websocket?.uploadS3
    ) {
      const endpoint =
        config.aws_s3.endpoint !== undefined && config.aws_s3.endpoint !== null
          ? config.aws_s3.endpoint
          : undefined;
      const s3Client = new S3Client({
        region: 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
        endpoint,
        forcePathStyle: Boolean(config.aws_s3?.forcePathStyle),
      });

      const ext = mimetypes.extension(message.mimetype || '') || 'bin';
      const fileName = `${message.from}/${Date.now()}.${ext}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.aws_s3.defaultBucketName ?? undefined,
          Key: fileName,
          Body: buffer,
          ContentType: message.mimetype || 'application/octet-stream',
          ACL: 'public-read',
        })
      );

      s3Url = `https://${config.aws_s3.defaultBucketName}.s3.${config.aws_s3.region}.amazonaws.com/${fileName}`;
    }

    if (!s3Url) return null;

    // --- 2. Procesamiento de IA ---
    if (isImage) {
      let mimeType = (message.mimetype || 'image/jpeg').toLowerCase();

      // Normalizar mimetype para OpenAI (jpeg es válido, pero asegurémonos de usar el formato correcto)
      // OpenAI acepta: image/png, image/jpeg, image/gif, image/webp
      if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
        mimeType = 'image/jpeg';
      } else if (mimeType.includes('png')) {
        mimeType = 'image/png';
      } else if (mimeType.includes('gif')) {
        mimeType = 'image/gif';
      } else if (mimeType.includes('webp')) {
        mimeType = 'image/webp';
      } else {
        // Si no reconocemos el formato, intentar como JPEG
        console.warn(
          `Formato de imagen desconocido: ${message.mimetype}, usando image/jpeg`
        );
        mimeType = 'image/jpeg';
      }

      try {
        // Usar base64 directamente - es más confiable que URLs y OpenAI lo acepta
        const base64Image = `data:${mimeType};base64,${buffer.toString(
          'base64'
        )}`;

        const response = await openai.chat.completions.create({
          model: 'gpt-5-nano',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analiza esta imagen de cancelería/comprobante y descríbela detalladamente.',
                },
                { type: 'image_url', image_url: { url: base64Image } },
              ],
            },
          ],
        });
        mediaDescription = response.choices[0].message.content;
      } catch (openaiError: any) {
        console.error('Error procesando imagen con OpenAI:', {
          code: openaiError.code,
          message: openaiError.message,
          mimetype: mimeType,
          bufferSize: buffer.length,
        });

        // Si falla, continuar sin descripción de IA pero guardar la URL de S3
        mediaDescription = `Imagen recibida (formato: ${mimeType}) - No se pudo procesar con IA`;
      }
    } else if (isAudio) {
      const originalExt = mimetypes.extension(message.mimetype || '') || 'oga';
      try {
        // Intento 1: Transcripción directa
        const file = await toFile(buffer, `audio.${originalExt}`, {
          type: message.mimetype,
        });
        const result = await transcribeWith(file);
        mediaDescription = result.text;
      } catch (err: any) {
        console.warn(
          'Fallo transcripción directa, intentando conversión a MP3...'
        );
        // Intento 2: Transcodificar si falla el formato original (.oga)
        const mp3 = await transcodeToMp3(buffer, originalExt);
        const file = await toFile(mp3.buf, mp3.filename, { type: mp3.mime });
        const result = await transcribeWith(file);
        mediaDescription = result.text;
      }
    } else if (isDocument) {
      mediaDescription = `Documento PDF recibido: ${message.filename || 'S/N'}`;
    }

    // --- 3. Guardar en Base de Datos ---
    const content = `${
      isImage ? 'IMAGE' : isAudio ? 'Audio' : isVideo ? 'Video' : 'Doc'
    }: ${s3Url}\n${mediaDescription || ''}`;

    thread.messages.push({
      role: fromSessionOwner ? 'assistant' : 'user',
      content: (message.caption ? `${message.caption}. ` : '') + content.trim(),
      timeStamps: new Date(),
      messageId:
        typeof message.id === 'string'
          ? message.id
          : message.id?._serialized ??
            (message.id != null ? String(message.id) : undefined),
    });

    await thread.save();

    return s3Url;
  } catch (err) {
    console.error('Error procesando contenido multimedia:', err);
    return null;
  }
}
