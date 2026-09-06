// Reseta o banco de teste (ssx_test, dentro do container ssx-pg-dev) para o
// estado do schema_postgres.sql. Roda via `docker exec` porque é o mesmo jeito
// que a seção 3 do CLAUDE.md já usa pra aplicar o schema — reaproveitado aqui
// para reaplicar em vez de aplicar pela primeira vez.
//
// Uso: node tests/db-reset.js
//
// SEGURANÇA: o container e o nome do banco são fixos no código (não vêm de
// env var) de propósito — este script dá DROP TABLE em cascata (é o que
// schema_postgres.sql faz) e não deve aceitar apontar para outro lugar por
// engano de configuração.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONTAINER = 'ssx-pg-dev';
const DATABASE = 'ssx_test';
const SCHEMA_FILE = path.join(__dirname, '..', 'schema_postgres.sql');

function containerIsRunning(name) {
  try {
    const out = execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', name], { encoding: 'utf-8' });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

if (!containerIsRunning(CONTAINER)) {
  console.log(`[db-reset] Container ${CONTAINER} parado — iniciando...`);
  execFileSync('docker', ['start', CONTAINER], { stdio: 'inherit' });
  // Postgres demora um instante pra aceitar conexões após o start.
  execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 2000)']);
}

// DROP DATABASE + CREATE DATABASE, em vez de reaplicar schema_postgres.sql
// por cima do banco existente: o arquivo não tem DROP TABLE pra toda tabela
// que cria (achado ao rodar reset pela 2ª vez — "config_request_types"
// already exists), então reaplicar sem recriar o banco falha no meio depois
// da 1ª execução. Recriar o banco inteiro garante estado limpo mesmo com
// essa lacuna no schema, sem precisar mexer no arquivo (é o schema de
// produção, fora do escopo desta suíte).
console.log(`[db-reset] Recriando o banco ${DATABASE} do zero em ${CONTAINER}...`);
execFileSync('docker', [
  'exec', CONTAINER, 'psql', '-U', 'postgres', '-c',
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DATABASE}' AND pid <> pg_backend_pid();`,
]);
execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-c', `DROP DATABASE IF EXISTS ${DATABASE};`]);
execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-c', `CREATE DATABASE ${DATABASE};`]);

console.log(`[db-reset] Reaplicando schema_postgres.sql em ${DATABASE}...`);
const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf-8');
execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'], {
  input: schemaSql,
  stdio: ['pipe', 'inherit', 'inherit'],
});

console.log('[db-reset] Concluído.');
