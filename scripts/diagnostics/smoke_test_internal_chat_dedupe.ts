// Smoke test do dedupe de conversa 1:1 no chat interno: confere que o índice
// único idx_internal_chats_direct_pair (migrations/internal_chats_direct_dedupe.sql)
// realmente impede duas linhas type='direct' com o mesmo par de membros, e
// que a query de "já existe conversa com esse par" (usada em
// app/api/chats/route.ts, action save-internal-chat) encontra a existente
// corretamente. Usa dois usuários e uma conversa descartáveis, limpa tudo no
// final.
import { Client } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let userAId: string | null = null;
  let userBId: string | null = null;
  const chatIds: string[] = [];
  try {
    await client.connect();

    const userA = await client.query(
      `INSERT INTO public.profiles (name, email, role, password) VALUES ($1, $2, 'Equipe', 'x') RETURNING id`,
      ['__smoke_test_dedupe_user_a__', `smoke_test_dedupe_a_${Date.now()}@example.invalid`]
    );
    userAId = userA.rows[0].id;
    const userB = await client.query(
      `INSERT INTO public.profiles (name, email, role, password) VALUES ($1, $2, 'Equipe', 'x') RETURNING id`,
      ['__smoke_test_dedupe_user_b__', `smoke_test_dedupe_b_${Date.now()}@example.invalid`]
    );
    userBId = userB.rows[0].id;
    console.log('✅ Usuários de teste criados:', userAId, userBId);

    const chat1Id = `d-smoke-${Date.now()}-1`;
    await client.query(
      `INSERT INTO public.internal_chats (id, name, type, member_ids) VALUES ($1, $2, 'direct', $3)`,
      [chat1Id, '__smoke_test_dedupe_user_b__', [userAId, userBId]]
    );
    chatIds.push(chat1Id);
    console.log('✅ Primeira conversa direct criada:', chat1Id);

    // Mesma query de dedupe usada no POST save-internal-chat: acha a
    // conversa existente pelo par de membros, id diferente do novo tentado.
    const chat2Id = `d-smoke-${Date.now()}-2`;
    const dupCheck = await client.query(
      `SELECT id FROM public.internal_chats
       WHERE type = 'direct' AND id <> $1
         AND cardinality(member_ids) = 2
         AND member_ids @> ARRAY[$2, $3]::uuid[]
       LIMIT 1`,
      [chat2Id, userAId, userBId]
    );
    if (dupCheck.rowCount !== 1 || dupCheck.rows[0].id !== chat1Id) {
      throw new Error(`Dedupe query não encontrou a conversa existente corretamente: ${JSON.stringify(dupCheck.rows)}`);
    }
    console.log('✅ Query de dedupe encontrou a conversa existente corretamente (não criaria duplicata)');

    // Confirma que o índice único de fato barra a inserção de uma segunda
    // linha direct pro mesmo par, mesmo se a checagem acima fosse ignorada
    // (ex.: corrida entre duas requisições simultâneas).
    let uniqueViolation = false;
    try {
      await client.query(
        `INSERT INTO public.internal_chats (id, name, type, member_ids) VALUES ($1, $2, 'direct', $3)`,
        [chat2Id, '__smoke_test_dedupe_user_b__ (duplicata)', [userBId, userAId]]
      );
      chatIds.push(chat2Id);
    } catch (err: any) {
      if (err.code === '23505') {
        uniqueViolation = true;
      } else {
        throw err;
      }
    }
    if (!uniqueViolation) throw new Error('Índice único não barrou a segunda conversa direct com o mesmo par (member_ids em ordem invertida)');
    console.log('✅ Índice único idx_internal_chats_direct_pair barrou a duplicata (inclusive com member_ids em ordem invertida)');

    console.log('\n🎉 TODOS OS TESTES PASSARAM');
  } catch (err: any) {
    console.error('\n❌ FALHOU:', err.message);
    process.exitCode = 1;
  } finally {
    try {
      for (const id of chatIds) await client.query('DELETE FROM public.internal_chats WHERE id = $1', [id]);
      if (userAId) await client.query('DELETE FROM public.profiles WHERE id = $1', [userAId]);
      if (userBId) await client.query('DELETE FROM public.profiles WHERE id = $1', [userBId]);
      console.log('🧹 Dados de teste removidos.');
    } catch (cleanupErr: any) {
      console.error('⚠️ Falha ao limpar dados de teste (verificar manualmente):', cleanupErr.message);
    }
    await client.end();
  }
}

run();
