// Mescla conversas 1:1 duplicadas no chat interno (mesmo par de membros em
// mais de uma linha de public.internal_chats — ex.: "3x Rodolfo
// Quintanilha" relatado pelo usuário) e, em seguida, aplica o índice único
// parcial de migrations/internal_chats_direct_dedupe.sql que impede
// duplicidade futura. Precisa rodar a mesclagem antes do índice: se
// aplicasse o índice primeiro, o CREATE UNIQUE INDEX falharia com os dados
// duplicados já existentes.
//
// Para cada grupo de duplicatas (mesmo par de member_ids, type='direct'):
// - canônica = a linha mais antiga (created_at ASC);
// - mensagens das demais são movidas (UPDATE chat_id) pra canônica, não
//   apagadas;
// - preferências por usuário (pinned_by/muted_by/read_later_by/hidden_by)
//   são unidas (união de arrays), pra ninguém perder um mute/pin que só
//   existia numa das duplicatas;
// - last_message_at da canônica vira o mais recente entre todas;
// - as linhas duplicadas (já sem mensagens) são removidas.
import { Client } from 'pg';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function unionArrays(...arrays: (string[] | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const arr of arrays) {
    for (const v of arr || []) set.add(v);
  }
  return [...set];
}

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const res = await client.query(
      `SELECT id, name, member_ids, created_at, last_message_at,
              pinned_by, pinned_message_ids, muted_by, read_later_by, hidden_by
       FROM public.internal_chats
       WHERE type = 'direct' AND cardinality(member_ids) = 2
       ORDER BY created_at ASC`
    );

    const groups = new Map<string, typeof res.rows>();
    for (const row of res.rows) {
      const pairKey = [...row.member_ids].sort().join('_');
      const group = groups.get(pairKey) || [];
      group.push(row);
      groups.set(pairKey, group);
    }

    const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);

    if (duplicateGroups.length === 0) {
      console.log('✅ Nenhuma conversa direta duplicada encontrada — nada para mesclar.');
    }

    for (const [pairKey, rows] of duplicateGroups) {
      const [canonical, ...duplicates] = rows;
      console.log(`\n🔀 Par ${pairKey}: ${rows.length} conversas (canônica: ${canonical.id} "${canonical.name}")`);

      let mergedLastMessageAt: string | null = canonical.last_message_at;
      let mergedPinnedBy = canonical.pinned_by || [];
      let mergedPinnedMessageIds = canonical.pinned_message_ids || [];
      let mergedMutedBy = canonical.muted_by || [];
      let mergedReadLaterBy = canonical.read_later_by || [];
      let mergedHiddenBy = canonical.hidden_by || [];

      for (const dup of duplicates) {
        const moved = await client.query(
          `UPDATE public.internal_chat_messages SET chat_id = $1 WHERE chat_id = $2 RETURNING id`,
          [canonical.id, dup.id]
        );
        console.log(`   ↳ mesclando duplicata ${dup.id} "${dup.name}" (${moved.rowCount} mensagem(ns) movida(s))`);

        mergedPinnedBy = unionArrays(mergedPinnedBy, dup.pinned_by);
        mergedPinnedMessageIds = unionArrays(mergedPinnedMessageIds, dup.pinned_message_ids);
        mergedMutedBy = unionArrays(mergedMutedBy, dup.muted_by);
        mergedReadLaterBy = unionArrays(mergedReadLaterBy, dup.read_later_by);
        mergedHiddenBy = unionArrays(mergedHiddenBy, dup.hidden_by);
        if (dup.last_message_at && (!mergedLastMessageAt || new Date(dup.last_message_at) > new Date(mergedLastMessageAt))) {
          mergedLastMessageAt = dup.last_message_at;
        }

        await client.query('DELETE FROM public.internal_chats WHERE id = $1', [dup.id]);
      }

      await client.query(
        `UPDATE public.internal_chats
         SET last_message_at = $1, pinned_by = $2, pinned_message_ids = $3,
             muted_by = $4, read_later_by = $5, hidden_by = $6
         WHERE id = $7`,
        [mergedLastMessageAt, mergedPinnedBy, mergedPinnedMessageIds, mergedMutedBy, mergedReadLaterBy, mergedHiddenBy, canonical.id]
      );
      console.log(`   ✅ Mesclagem do par ${pairKey} concluída — conversa final: ${canonical.id}`);
    }

    console.log(`\n📊 Total de grupos duplicados mesclados: ${duplicateGroups.length}`);

    const sql = fs.readFileSync(path.resolve(process.cwd(), 'migrations/internal_chats_direct_dedupe.sql'), 'utf-8');
    await client.query(sql);
    console.log('✅ Índice único idx_internal_chats_direct_pair criado (ou já existia).');

    console.log('\n🎉 CONCLUÍDO');
  } catch (err: any) {
    console.error('\n❌ FALHOU:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
