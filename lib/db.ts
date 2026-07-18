import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Carregar variáveis do .env caso o script esteja rodando isolado (ex: worker do whatsapp)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ AVISO: A variável de ambiente DATABASE_URL não está configurada!');
}

export const pool = new Pool({
  connectionString,
  max: 20, // Limite de conexões concorrentes no pool
  idleTimeoutMillis: 30000, // Tempo limite de conexões inativas
  connectionTimeoutMillis: 5000, // Tempo limite de conexão inicial
});

// Sem esse listener, um erro em um client ocioso do pool (conexão resetada
// pela rede/banco) vira uma exceção não tratada e derruba o processo do
// Next.js inteiro — o que explica os 500 intermitentes em rotas de API
// aparentemente não relacionadas entre si.
pool.on('error', (err) => {
  console.error('⚠️ Erro inesperado em client ocioso do pool Postgres:', err);
});

export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}
