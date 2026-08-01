import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Carregar variáveis do .env caso o script esteja rodando isolado (ex: worker do whatsapp)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ AVISO: A variável de ambiente DATABASE_URL não está configurada!');
}

// Guarda em globalThis pra sobreviver ao hot-reload do Next.js em dev — mesmo
// padrão já usado por lib/services/automation-scheduler.ts,
// lib/services/hotfix-scheduler.ts e whatsapp-service.ts. Sem isso, cada Fast
// Refresh podia reavaliar este módulo e criar um Pool novo (até +20 conexões)
// sem fechar o anterior — as conexões antigas só somem quando o
// idleTimeoutMillis (30s) as fecha sozinho, então um pico de vazamento durante
// uma sessão de dev longa se autolimpa antes de dar pra flagrar num snapshot,
// mas enquanto acontece deixa toda query nova (mesmo trivial, em tabela sem
// relação) esperando na fila interna do pool por uma conexão livre — sem
// erro, só lentidão uniforme e aparentemente sem causa em rotas não
// relacionadas entre si.
declare global {
  var pgPool: Pool | undefined;
}

export const pool = global.pgPool ?? new Pool({
  connectionString,
  max: 20, // Limite de conexões concorrentes no pool
  idleTimeoutMillis: 30000, // Tempo limite de conexões inativas
  connectionTimeoutMillis: 5000, // Tempo limite de conexão inicial
});

if (!global.pgPool) {
  global.pgPool = pool;

  // Sem esse listener, um erro em um client ocioso do pool (conexão resetada
  // pela rede/banco) vira uma exceção não tratada e derruba o processo do
  // Next.js inteiro — o que explica os 500 intermitentes em rotas de API
  // aparentemente não relacionadas entre si.
  pool.on('error', (err) => {
    console.error('⚠️ Erro inesperado em client ocioso do pool Postgres:', err);
  });
}

export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}
