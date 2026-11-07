/**
 * El middleware de respuesta hacía JSON.parse sobre todo lo que salía
 * en rutas application/json. res.send(objeto) se convierte en el texto
 * "[object Object]" y JSON.parse revienta la petición.
 */
export function coerceJsonSendBody(data: unknown): unknown {
  if (data == null) return data;
  if (typeof data === 'object' && !Buffer.isBuffer(data)) return data;
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  try {
    return JSON.parse(text);
  } catch {
    return data;
  }
}
