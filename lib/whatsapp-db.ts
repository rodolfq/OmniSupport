import { Pool } from 'pg';

// Pool dedicado à conexão WhatsApp (mesmo banco/servidor, conexões isoladas)
// para que picos de mensagens não disputem conexões com o restante da aplicação.
const connectionString = process.env.DATABASE_URL;

export const whatsappPool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function whatsappQuery(text: string, params?: any[]) {
  return whatsappPool.query(text, params);
}
