/**
 * Diagnóstico local canserv: token → status → (opcional) send.
 * Uso:
 *   node scripts/debug-wa.mjs status 5213331184802@c.us
 *   node scripts/debug-wa.mjs qr 5213331184802@c.us
 *   node scripts/debug-wa.mjs start 5213331184802@c.us
 *   node scripts/debug-wa.mjs send 5213331184802@c.us 3331184802 "hola test"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.CANSERV_URL || 'http://localhost:21465';
const SECRET = process.env.CANSERV_SECRET || 'THISISMYSECURETOKEN';

const [cmd, session, phoneOrUnused, message] = process.argv.slice(2);

if (!cmd || !session) {
  console.error(
    'Uso: node scripts/debug-wa.mjs <status|qr|start|send|check> <session> [phone] [message]'
  );
  process.exit(1);
}

async function getToken(sess) {
  const cachePath = path.join(
    __dirname,
    `.token-cache-${sess.replace(/[^a-zA-Z0-9@._-]/g, '_')}.json`
  );
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.token && cached.session === sess) return cached.token;
    } catch (_) {}
  }
  const res = await fetch(
    `${BASE}/api/${encodeURIComponent(sess)}/${SECRET}/generate-token`,
    {
      method: 'POST',
    }
  );
  const data = await res.json();
  if (!res.ok)
    throw new Error(`generate-token ${res.status}: ${JSON.stringify(data)}`);
  fs.writeFileSync(
    cachePath,
    JSON.stringify({ session: sess, token: data.token }, null, 2)
  );
  console.log('Token generado y cacheado (no se imprime el valor).');
  return data.token;
}

async function authed(method, urlPath, body, { raw = false } = {}) {
  const token = await getToken(session);
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get('content-type') || '';
  if (raw || contentType.includes('image/')) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: buf, contentType };
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 500);
  }
  return { status: res.status, data, contentType };
}

async function main() {
  console.log(`BASE=${BASE}`);
  console.log(`cmd=${cmd} session=${session}`);

  if (cmd === 'status') {
    const r = await authed(
      'GET',
      `/api/${encodeURIComponent(session)}/check-connection-session`
    );
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === 'start') {
    const r = await authed(
      'POST',
      `/api/${encodeURIComponent(session)}/start-session`,
      {}
    );
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === 'qr') {
    const r = await authed(
      'GET',
      `/api/${encodeURIComponent(session)}/qrcode-session`,
      undefined,
      {
        raw: true,
      }
    );
    const out = path.join(__dirname, 'debug-qr.png');
    if (Buffer.isBuffer(r.data) && r.data.length > 100 && r.data[0] === 0x89) {
      fs.writeFileSync(out, r.data);
      console.log({
        httpStatus: r.status,
        contentType: r.contentType,
        bytes: r.data.length,
        saved: out,
      });
      return;
    }
    // fallback JSON base64
    let parsed;
    try {
      parsed = JSON.parse(r.data.toString('utf8'));
    } catch {
      parsed = null;
    }
    if (typeof parsed?.qrcode === 'string' && parsed.qrcode.length > 100) {
      const b64 = parsed.qrcode.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(out, Buffer.from(b64, 'base64'));
      console.log({ httpStatus: r.status, saved: out, from: 'json.qrcode' });
      return;
    }
    console.log({
      httpStatus: r.status,
      contentType: r.contentType,
      preview: Buffer.isBuffer(r.data)
        ? r.data.toString('utf8').slice(0, 300)
        : r.data,
    });
    return;
  }

  if (cmd === 'send') {
    if (!phoneOrUnused || !message) {
      console.error('send requiere phone y message');
      process.exit(1);
    }
    const r = await authed(
      'POST',
      `/api/${encodeURIComponent(session)}/send-message`,
      {
        phone: phoneOrUnused,
        message,
        isGroup: false,
      }
    );
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === 'check') {
    // Solo valida auth + middleware connection sin enviar
    const r = await authed(
      'POST',
      `/api/${encodeURIComponent(session)}/send-message`,
      {
        phone: phoneOrUnused || '5210000000000',
        message: 'diagnostic-ping-should-fail-or-send',
        isGroup: false,
      }
    );
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  console.error('Comando desconocido');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
