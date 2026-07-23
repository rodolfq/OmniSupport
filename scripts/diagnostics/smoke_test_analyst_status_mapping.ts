// Confere o bug de mapeamento snake_case/camelCase encontrado em
// analyst_status (app/api/config/route.ts, ação analyst-statuses, e
// app/(portal)/chat-management/page.tsx) — antes s.isOnline/s.userId vinham
// sempre undefined porque a API devolvia a linha crua do Postgres. Aqui só
// confirma que a query base + o mapeamento manual (replicado da rota)
// produzem os campos camelCase esperados pela interface AnalystStatus.
import { Client } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function mapRow(r: any) {
  return {
    userId: r.user_id,
    isOnline: r.is_online,
    lastActive: r.last_active,
    currentLoad: r.current_load,
    currentReason: r.current_reason,
    status: r.status
  };
}

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let userId: string | null = null;
  try {
    await client.connect();

    const user = await client.query(
      `INSERT INTO public.profiles (name, email, role, password) VALUES ($1, $2, 'Equipe', 'x') RETURNING id`,
      ['__smoke_test_analyst_status__', `smoke_test_analyst_status_${Date.now()}@example.invalid`]
    );
    userId = user.rows[0].id;

    await client.query(
      `INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load, status)
       VALUES ($1, true, NOW(), 2, 'online')
       ON CONFLICT (user_id) DO UPDATE SET is_online = EXCLUDED.is_online, status = EXCLUDED.status`,
      [userId]
    );

    const res = await client.query('SELECT * FROM public.analyst_status WHERE user_id = $1', [userId]);
    const mapped = mapRow(res.rows[0]);

    if (mapped.userId !== userId) throw new Error(`userId não mapeou: ${JSON.stringify(mapped)}`);
    if (mapped.isOnline !== true) throw new Error(`isOnline não mapeou: ${JSON.stringify(mapped)}`);
    if (mapped.currentLoad !== 2) throw new Error(`currentLoad não mapeou: ${JSON.stringify(mapped)}`);
    if (mapped.status !== 'online') throw new Error(`status não mapeou: ${JSON.stringify(mapped)}`);
    console.log('✅ Mapeamento camelCase de analyst_status OK:', JSON.stringify(mapped));

    console.log('\n🎉 TODOS OS TESTES PASSARAM');
  } catch (err: any) {
    console.error('\n❌ FALHOU:', err.message);
    process.exitCode = 1;
  } finally {
    try {
      if (userId) await client.query('DELETE FROM public.analyst_status WHERE user_id = $1', [userId]);
      if (userId) await client.query('DELETE FROM public.profiles WHERE id = $1', [userId]);
      console.log('🧹 Dados de teste removidos.');
    } catch (cleanupErr: any) {
      console.error('⚠️ Falha ao limpar dados de teste (verificar manualmente):', cleanupErr.message);
    }
    await client.end();
  }
}

run();
