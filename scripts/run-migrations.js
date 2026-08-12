#!/usr/bin/env node
/**
 * Runner das migrations de migrations/*.sql.
 *
 * Até aqui o projeto não tinha nenhum controle do que já rodou (dívida
 * conhecida — seção 14, item 9 do CLAUDE.md): cada arquivo era aplicado na
 * mão, uma vez, e o que já tinha rodado só existia na memória de quem aplicou.
 * Com o deploy em container isso vira problema de verdade, porque quem sobe a
 * versão nova não é necessariamente quem escreveu a migration.
 *
 * Uso:
 *   node scripts/run-migrations.js --baseline
 *       Marca TODAS as migrations existentes como já aplicadas, sem executar
 *       nenhuma. É o primeiro comando a rodar contra o banco atual, que já
 *       tem tudo aplicado manualmente — sem isso a primeira execução normal
 *       tentaria reaplicar o histórico inteiro.
 *
 *   node scripts/run-migrations.js
 *       Aplica, em ordem alfabética, só o que ainda não está registrado.
 *       Cada arquivo roda dentro de uma transação: falhou, nada daquele
 *       arquivo fica pela metade e o processo para (as seguintes não rodam).
 *
 *   node scripts/run-migrations.js --status
 *       Só lista o que está pendente. Não escreve nada.
 *
 *   node scripts/run-migrations.js --force
 *       Igual ao modo normal, mas aceita aplicar o histórico INTEIRO num
 *       registro vazio (banco novo, do zero). Sem --force isso é recusado,
 *       porque o mesmo estado descreve um banco que só não passou pelo
 *       --baseline ainda — e reaplicar 66 migrations por engano quebra no meio.
 *
 * NÃO toca em schema_postgres.sql — aquele arquivo começa com
 * DROP TABLE ... CASCADE e nunca deve rodar contra um banco com dados.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function main() {
  const mode = process.argv[2] || '';
  if (mode && !['--baseline', '--status', '--force'].includes(mode)) {
    console.error(`Argumento desconhecido: ${mode}`);
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definida.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- 'baseline' = marcada como aplicada sem execução (histórico que já
        -- estava no banco antes deste runner existir).
        applied_by TEXT NOT NULL DEFAULT 'runner'
      )
    `);

    const appliedRes = await pool.query('SELECT filename FROM public.schema_migrations');
    const applied = new Set(appliedRes.rows.map(r => r.filename));
    const pending = files.filter(f => !applied.has(f));

    if (mode === '--status') {
      console.log(`Aplicadas: ${applied.size} | Pendentes: ${pending.length}`);
      pending.forEach(f => console.log(`  pendente: ${f}`));
      return;
    }

    if (mode === '--baseline') {
      if (!pending.length) {
        console.log('Nada a marcar — todas as migrations já estão registradas.');
        return;
      }
      await pool.query(
        `INSERT INTO public.schema_migrations (filename, applied_by)
         SELECT unnest($1::text[]), 'baseline'
         ON CONFLICT (filename) DO NOTHING`,
        [pending]
      );
      console.log(`${pending.length} migration(s) marcadas como aplicadas (baseline), sem execução.`);
      return;
    }

    if (!pending.length) {
      console.log('Nenhuma migration pendente.');
      return;
    }

    // Trava de segurança: registro vazio + banco com histórico é exatamente o
    // estado de quem ainda não rodou o --baseline. Aplicar as 66 migrations
    // antigas contra um banco que já as tem daria erro no meio (nem todas são
    // idempotentes) e, pior, no meio de uma sequência. Quem realmente quer
    // aplicar tudo (banco novo, do zero) passa --force.
    if (applied.size === 0 && !process.argv.includes('--force')) {
      console.error(
        'Nenhuma migration registrada e há ' + pending.length + ' arquivo(s) pendente(s).\n' +
        'Se este banco já tem o histórico aplicado à mão, rode primeiro:\n' +
        '  node scripts/run-migrations.js --baseline\n' +
        'Se for um banco novo (vazio), confirme com:\n' +
        '  node scripts/run-migrations.js --force'
      );
      process.exitCode = 1;
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (filename, applied_by) VALUES ($1, $2)',
          [file, 'runner']
        );
        await client.query('COMMIT');
        console.log(`aplicada: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`FALHOU: ${file}\n${err.message}`);
        process.exitCode = 1;
        return;
      } finally {
        client.release();
      }
    }
    console.log('Migrations aplicadas com sucesso.');
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
