import { ServerOptions } from './types/ServerOptions';

export default {
  secretKey: 'THISISMYSECURETOKEN',
  host: 'http://localhost',
  port: '21465',
  deviceName: 'WppConnect',
  poweredBy: 'WPPConnect-Server',
  // En Ubuntu/PM2: relanza sesiones al arrancar para mantener el servicio estable.
  startAllSession: true,
  tokenStoreType: 'file',
  maxListeners: 15,
  customUserDataDir: './userDataDir/',
  webhook: {
    url: process.env.WEBHOOK_URL || 'https://api.cotizadoraluminio.mx/garabato',
    autoDownload: true,
    uploadS3: true,
    readMessage: false,
    allUnreadOnStart: false,
    // Menos eventos = menos carga y menos riesgo de OOM con varias sesiones.
    listenAcks: false,
    onPresenceChanged: false,
    onParticipantsChanged: true,
    onReactionMessage: true,
    onPollResponse: true,
    onRevokedMessage: true,
    onLabelUpdated: true,
    onSelfMessage: true,
    ignore: ['status@broadcast'],
  },
  websocket: {
    autoDownload: true,
    uploadS3: true,
  },
  chatwoot: {
    sendQrCode: true,
    sendStatus: true,
  },
  archive: {
    enable: true,
    waitTime: 10,
    daysToArchive: 45,
  },
  log: {
    level: process.env.LOG_LEVEL || 'error',
    logger: ['console', 'file'],
  },
  createOptions: {
    /**
     * Vacío = versión actual de WhatsApp Web (requerido con wppconnect >=2.x).
     */
    whatsappVersion: '',
    browserArgs: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--ignore-certificate-errors',
    ],
    /**
     * Example of configuring the linkPreview generator
     * If you set this to 'null', it will use global servers; however, you have the option to define your own server
     * Clone the repository https://github.com/wppconnect-team/wa-js-api-server and host it on your server with ssl
     *
     * Configure the attribute as follows:
     * linkPreviewApiServers: [ 'https://www.yourserver.com/wa-js-api-server' ]
     */
    linkPreviewApiServers: null,
    /**
     * 0 = no cerrar el browser por timeout de QR.
     * Sobrescribe con WPP_AUTO_CLOSE_MS (ej. 300000).
     */
    autoClose: (() => {
      const v = process.env.WPP_AUTO_CLOSE_MS;
      if (v === undefined || v === '') return 0;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? 0 : n;
    })(),
  },
  mapper: {
    enable: true,
    prefix: 'tagone-',
  },
  db: {
    mongodbDatabase: 'whatsappChats',
    mongodbCollection: '',
    mongodbUser: '',
    mongodbPassword: '',
    mongodbHost: '',
    mongoIsRemote: true,
    mongoURLRemote: process.env.MONGO_URL,
    mongodbPort: 27017,
    redisHost: 'localhost',
    redisPort: 6379,
    redisPassword: '',
    redisDb: 0,
    redisPrefix: 'docker',
  },
  aws_s3: {
    region: 'us-east-1',
    access_key_id: 'AKIAXOQPDYH7KCIJYQXP', // Move to .env
    secret_key: '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', // Move to .env
    defaultBucketName: 'cdjwhatsapchats',
    endpoint: 'https://s3.us-east-1.amazonaws.com', // Correct S3 endpoint
    forcePathStyle: false, // Keep for path-style URLs
  },
  openai: {
    model: 'gpt-4o',
  },
} as unknown as ServerOptions;
