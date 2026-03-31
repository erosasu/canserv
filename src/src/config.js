// config.js
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  api: {
    psiBaseUrl:
      process.env.PSI_BASE_URL || 'https://api.platvialum.com/psi_no_auth',
    quoteBaseUrl: 'https://api.platvialum.com' || 'http://localhost:3002',
    lambdaUrl:
      process.env.LAMBDA_URL ||
      'https://8oz59l1g26.execute-api.us-east-1.amazonaws.com/default/serverPlatvialum',
  },
  bank: {
    accountInfo: `Banco BBVA
      Nombre: Ernesto Rosas Uriarte
      CLABE: 012320004828656106
      Cuenta: 0482865610
      Tarjeta: 4152314388391917`,
    address:
      process.env.BANK_ADDRESS ||
      'Av. Valdepeñas 2565 esquina con Tolosa, Lomas de Zapopan, Jalisco',
  },
  catalog: {
    url:
      process.env.CATALOG_URL ||
      'https://platvialum.com/portafolio/6490fc33b844a5d0f55ab865',
  },
};

if (!config.openai.apiKey) {
  throw new Error('OPENAI_API_KEY is not set in environment variables');
}
