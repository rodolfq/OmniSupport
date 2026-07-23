// Smoke test das novas features de tempo real do Chat Interno e do chat com
// cliente: entrega/leitura persistidas, reações, edição com histórico e
// exclusão com soft-delete auditável. Roda as MESMAS queries usadas nas
// rotas (app/api/chats/route.ts) direto contra o banco real, com dados
// descartáveis, limpando tudo no final.
import { Client } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let userAId: string | null = null;
  let userBId: string | null = null;
  let internalChatId: string | null = null;
  let sessionId: string | null = null;
  try {
    await client.connect();

    const userA = await client.query(
      `INSERT INTO public.profiles (name, email, role, password) VALUES ($1, $2, 'Equipe', 'x') RETURNING id`,
      ['__smoke_test_rt_user_a__', `smoke_test_rt_a_${Date.now()}@example.invalid`]
    );
    userAId = userA.rows[0].id;
    const userB = await client.query(
      `INSERT INTO public.profiles (name, email, role, password) VALUES ($1, $2, 'Cliente', 'x') RETURNING id`,
      ['__smoke_test_rt_user_b__', `smoke_test_rt_b_${Date.now()}@example.invalid`]
    );
    userBId = userB.rows[0].id;
    console.log('✅ Usuários de teste criados');

    // ===== CHAT INTERNO =====
    internalChatId = `d-smoke-rt-${Date.now()}`;
    await client.query(
      `INSERT INTO public.internal_chats (id, name, type, member_ids) VALUES ($1, 'Teste RT', 'direct', $2)`,
      [internalChatId, [userAId, userBId]]
    );
    const msgA = await client.query(
      `INSERT INTO public.internal_chat_messages (chat_id, sender_id, sender_name, text, type)
       VALUES ($1, $2, 'A', 'oi', 'text') RETURNING id`,
      [internalChatId, userAId]
    );
    const internalMsgId = msgA.rows[0].id;

    // Mesma query de internal-chats GET (marca delivered_by)
    await client.query(
      `UPDATE public.internal_chat_messages m
       SET delivered_by = array_append(m.delivered_by, $1::uuid)
       FROM public.internal_chats c
       WHERE m.chat_id = c.id AND $1::uuid = ANY(c.member_ids)
         AND m.sender_id IS DISTINCT FROM $1 AND NOT ($1::uuid = ANY(m.delivered_by))`,
      [userBId]
    );
    // Mesma query de internal-messages GET (marca read_by)
    await client.query(
      `UPDATE public.internal_chat_messages
       SET read_by = array_append(read_by, $2::uuid),
           delivered_by = CASE WHEN $2::uuid = ANY(delivered_by) THEN delivered_by ELSE array_append(delivered_by, $2::uuid) END
       WHERE chat_id = $1 AND sender_id IS DISTINCT FROM $2 AND NOT ($2::uuid = ANY(read_by))`,
      [internalChatId, userBId]
    );
    const checkInternal = await client.query('SELECT read_by, delivered_by FROM public.internal_chat_messages WHERE id = $1', [internalMsgId]);
    if (!checkInternal.rows[0].delivered_by.includes(userBId) || !checkInternal.rows[0].read_by.includes(userBId)) {
      throw new Error('Chat Interno: read_by/delivered_by não persistiram: ' + JSON.stringify(checkInternal.rows[0]));
    }
    console.log('✅ Chat Interno: entrega + leitura persistidas OK');

    // Reação: toggle liga, toggle de novo desliga
    await client.query(
      `INSERT INTO public.internal_chat_message_reactions (message_id, user_id, emoji) VALUES ($1, $2, '👍')
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji`,
      [internalMsgId, userBId]
    );
    const reactionCheck1 = await client.query('SELECT emoji FROM public.internal_chat_message_reactions WHERE message_id = $1 AND user_id = $2', [internalMsgId, userBId]);
    if (reactionCheck1.rows[0]?.emoji !== '👍') throw new Error('Chat Interno: reação não gravou');
    const removed = await client.query('DELETE FROM public.internal_chat_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING id', [internalMsgId, userBId, '👍']);
    if ((removed.rowCount ?? 0) !== 1) throw new Error('Chat Interno: toggle de remoção de reação não funcionou');
    console.log('✅ Chat Interno: reações (toggle liga/desliga) OK');

    // ===== CHAT COM CLIENTE =====
    sessionId = crypto.randomUUID();
    await client.query(
      `INSERT INTO public.chat_sessions (id, customer_id, customer_name, status, assignee_id, created_at, updated_at)
       VALUES ($1, $2, 'Cliente Teste RT', 'active', $3, NOW(), NOW())`,
      [sessionId, userBId, userAId]
    );
    const msgC = await client.query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type) VALUES ($1, $2, 'A', 'oi cliente', 'text') RETURNING id`,
      [sessionId, userAId]
    );
    const chatMsgId = msgC.rows[0].id;

    // Mesma query de sessions GET (delivered_by escopado por participante)
    await client.query(
      `UPDATE public.chat_messages m
       SET delivered_by = array_append(m.delivered_by, $1::uuid)
       FROM public.chat_sessions s
       WHERE m.session_id = s.id AND (s.customer_id = $1::uuid OR s.assignee_id = $1::uuid)
         AND m.sender_id IS DISTINCT FROM $1 AND NOT ($1::uuid = ANY(m.delivered_by))`,
      [userBId]
    );
    // Mesma query de mark-chat-messages-read
    await client.query(
      `UPDATE public.chat_messages
       SET read_by = array_append(read_by, $2::uuid),
           delivered_by = CASE WHEN $2::uuid = ANY(delivered_by) THEN delivered_by ELSE array_append(delivered_by, $2::uuid) END
       WHERE session_id = $1 AND sender_id IS DISTINCT FROM $2 AND NOT ($2::uuid = ANY(read_by))`,
      [sessionId, userBId]
    );
    const checkClient = await client.query('SELECT read_by, delivered_by FROM public.chat_messages WHERE id = $1', [chatMsgId]);
    if (!checkClient.rows[0].delivered_by.includes(userBId) || !checkClient.rows[0].read_by.includes(userBId)) {
      throw new Error('Chat Cliente: read_by/delivered_by não persistiram: ' + JSON.stringify(checkClient.rows[0]));
    }
    console.log('✅ Chat Cliente: entrega + leitura persistidas OK');

    // Reação
    await client.query(
      `INSERT INTO public.chat_message_reactions (message_id, user_id, emoji) VALUES ($1, $2, '❤️')
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji`,
      [chatMsgId, userBId]
    );
    const reactionCheck2 = await client.query('SELECT emoji FROM public.chat_message_reactions WHERE message_id = $1 AND user_id = $2', [chatMsgId, userBId]);
    if (reactionCheck2.rows[0]?.emoji !== '❤️') throw new Error('Chat Cliente: reação não gravou');
    console.log('✅ Chat Cliente: reação OK');

    // Edição com histórico — mesma lógica da action edit-chat-message
    const originalRes = await client.query('SELECT text FROM public.chat_messages WHERE id = $1', [chatMsgId]);
    const originalText = originalRes.rows[0].text;
    await client.query('INSERT INTO public.chat_message_edits (message_id, previous_text, edited_by) VALUES ($1, $2, $3)', [chatMsgId, originalText, userAId]);
    await client.query('UPDATE public.chat_messages SET text = $1, edited_at = NOW() WHERE id = $2', ['oi cliente (editado)', chatMsgId]);
    const historyRes = await client.query('SELECT previous_text FROM public.chat_message_edits WHERE message_id = $1', [chatMsgId]);
    if (historyRes.rows.length !== 1 || historyRes.rows[0].previous_text !== 'oi cliente') {
      throw new Error('Chat Cliente: histórico de edição não bateu: ' + JSON.stringify(historyRes.rows));
    }
    const afterEditRes = await client.query('SELECT text, edited_at FROM public.chat_messages WHERE id = $1', [chatMsgId]);
    if (afterEditRes.rows[0].text !== 'oi cliente (editado)' || !afterEditRes.rows[0].edited_at) {
      throw new Error('Chat Cliente: texto/edited_at não atualizaram');
    }
    console.log('✅ Chat Cliente: edição com histórico OK (texto anterior preservado em chat_message_edits)');

    // Exclusão (soft-delete) — texto original nunca é apagado da linha
    const deleteRes = await client.query(
      `UPDATE public.chat_messages SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL RETURNING session_id`,
      [chatMsgId, userAId]
    );
    if (deleteRes.rowCount !== 1) throw new Error('Chat Cliente: soft-delete não afetou 1 linha (checar sender_id)');
    const afterDeleteRes = await client.query('SELECT text, deleted_at FROM public.chat_messages WHERE id = $1', [chatMsgId]);
    if (!afterDeleteRes.rows[0].deleted_at) throw new Error('Chat Cliente: deleted_at não persistiu');
    if (afterDeleteRes.rows[0].text !== 'oi cliente (editado)') {
      throw new Error('Chat Cliente: soft-delete apagou o texto (deveria só marcar deleted_at, mantendo o texto pro histórico auditável)');
    }
    console.log('✅ Chat Cliente: exclusão OK (soft-delete — texto original preservado no banco, só marcado deleted_at)');

    // Exclusão por quem NÃO é o dono deve falhar (0 linhas afetadas)
    const msgD = await client.query(`INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type) VALUES ($1, $2, 'A', 'outra', 'text') RETURNING id`, [sessionId, userAId]);
    const wrongDelete = await client.query(
      `UPDATE public.chat_messages SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL RETURNING id`,
      [msgD.rows[0].id, userBId]
    );
    if ((wrongDelete.rowCount ?? 0) !== 0) throw new Error('Exclusão por quem não é dono da mensagem não deveria ter funcionado');
    console.log('✅ Chat Cliente: exclusão bloqueada corretamente pra quem não é o remetente');

    console.log('\n🎉 TODOS OS TESTES PASSARAM');
  } catch (err: any) {
    console.error('\n❌ FALHOU:', err.message);
    process.exitCode = 1;
  } finally {
    try {
      if (sessionId) await client.query('DELETE FROM public.chat_sessions WHERE id = $1', [sessionId]);
      if (internalChatId) await client.query('DELETE FROM public.internal_chats WHERE id = $1', [internalChatId]);
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
