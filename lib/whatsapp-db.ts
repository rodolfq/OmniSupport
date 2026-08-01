import { Pool } from 'pg';

// Pool dedicado à conexão WhatsApp (mesmo banco/servidor, conexões isoladas)
// para que picos de mensagens não disputem conexões com o restante da aplicação.
const connectionString = process.env.DATABASE_URL;

// Mesma guarda de globalThis de lib/db.ts (ver comentário lá) — sem isso,
// hot-reload em dev podia recriar este pool (+5 conexões) a cada Fast
// Refresh sem fechar o anterior.
declare global {
  var whatsappPgPool: Pool | undefined;
}

export const whatsappPool = global.whatsappPgPool ?? new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

if (!global.whatsappPgPool) {
  global.whatsappPgPool = whatsappPool;
}

export async function whatsappQuery(text: string, params?: any[]) {
  return whatsappPool.query(text, params);
}
