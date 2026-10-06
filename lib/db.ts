import { Pool, PoolClient } from 'pg';
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
  // Conexões ociosas são fechadas antes de 10 s. Com 30 s, uma conexão parada ficava
  // no pool por tempo suficiente para a rede/NAT derrubá-la sem avisar; a próxima
  // consulta que reaproveitava esse socket morto falhava com "Connection terminated
  // unexpectedly".
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000, // Tempo limite de conexão inicial
  // Keepalive de TCP: mantém o socket vivo enquanto a conexão está no pool, e detecta
  // queda de rede antes de a consulta chegar nele.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
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

// Erro de conexão perdida: a conexão foi derrubada pela rede ou pelo banco, não é um erro
// da consulta em si. Quem recebe isso pode tentar de novo.
const LOST_CONNECTION_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '08000', '08003', '08006']);
const LOST_CONNECTION_MESSAGE = /Connection terminated|Client has encountered a connection error|connection (was )?closed|socket hang up/i;

export function isConnectionLostError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === 'string' && LOST_CONNECTION_CODES.has(e.code)) return true;
  return typeof e.message === 'string' && LOST_CONNECTION_MESSAGE.test(e.message);
}

// Só leitura pode ser repetida sem risco. Um INSERT/UPDATE/DELETE repetido poderia gravar
// duas vezes, então esses nunca são repetidos.
export function isReadOnlySql(text: string): boolean {
  const head = text.trimStart().slice(0, 6).toUpperCase();
  if (!(head.startsWith('SELECT') || head.startsWith('WITH'))) return false;
  return !/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|FOR UPDATE)\b/i.test(text);
}

// Uma consulta de leitura que falha porque a conexão reaproveitada do pool caiu é
// repetida UMA vez. O pool já descarta o cliente quebrado, então a segunda tentativa
// abre uma conexão nova. Escrita e erros de SQL seguem sem repetição.
export async function query(text: string, params?: any[]) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    if (isConnectionLostError(err) && isReadOnlySql(text)) {
      return pool.query(text, params);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Registro rígido de criação de usuário (migrations/user_creation_log.sql)
//
// Todo INSERT em public.profiles dispara um gatilho que grava, na MESMA
// transação, quem foi criado e por qual login. O gatilho lê o autor de
// variáveis de sessão (app.*) — este helper as define. Elas são locais à
// transação (set_config ..., true): não vazam pra outra requisição que reuse a
// conexão do pool. Se o log falhar, a criação inteira é desfeita.
//
// Quem cria usuário DEVE passar por aqui pra o registro trazer o login do autor.
// Um INSERT fora daqui ainda é registrado, mas como source 'desconhecido' e sem
// autor — por isso, ao criar um caminho novo, use withCreationContext.
export interface CreationContext {
  /** Login (profiles.id) de quem está criando. Sem login (sistema/API) = null. */
  actorId?: string | null;
  /** Origem da criação: 'portal-cliente', 'portal-equipe', 'chat-vincular', 'api-integracao'... */
  source: string;
  /** Descrição quando não há login (ex.: nome da chave de API, nome da rotina de sincronização). */
  actorLabel?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

// Define o contexto de criação na transação JÁ ABERTA de um client. Use quando o
// caminho precisa do próprio BEGIN/COMMIT (ex.: empresa + administrador juntos);
// senão prefira withCreationContext.
export async function applyCreationContext(client: PoolClient, ctx: CreationContext): Promise<void> {
  await client.query(
    `SELECT set_config('app.actor_id', $1, true),
            set_config('app.source', $2, true),
            set_config('app.actor_label', $3, true),
            set_config('app.ip', $4, true),
            set_config('app.user_agent', $5, true)`,
    [
      ctx.actorId || '',
      ctx.source,
      ctx.actorLabel || '',
      (ctx.ip || '').slice(0, 100),
      (ctx.userAgent || '').slice(0, 300)
    ]
  );
}

export async function withCreationContext<T>(
  ctx: CreationContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyCreationContext(client, ctx);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// IP e navegador de quem fez a requisição, pro registro acima. Atrás do proxy o
// IP de verdade vem em X-Forwarded-For (primeiro endereço da lista).
export function requestMeta(request: { headers: Headers }): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip')) || null;
  return { ip, userAgent: request.headers.get('user-agent') || null };
}
