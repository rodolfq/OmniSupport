// Remove exatamente os dados criados por scripts/dev-seed/seed.ts, lendo os
// ids gravados em seed-manifest.json — não apaga por convenção de nome
// (mais seguro: não corre risco de pegar dado real que por acaso combine
// com um padrão). Ordem de exclusão respeita as FKs que não são CASCADE
// (chat_histories.session_id é SET NULL, não CASCADE, por isso vem antes
// dos chat_sessions; os demais filhos — chat_messages, chat_participants,
// chat_session_viewers, analyst_status, user_status_history — têm CASCADE
// nas tabelas pai e são limpos sozinhos).
//
// Uso: npx ts-node scripts/dev-seed/unseed.ts

import fs from 'fs';
import path from 'path';
import { query, pool } from '../../lib/db';

const MANIFEST_PATH = path.join(__dirname, 'seed-manifest.json');

interface Manifest {
  companyIds: string[];
  profileIds: string[];
  queueIds: string[];
  whatsappInstanceIds: string[];
  chatSessionIds: string[];
  chatHistoryIds: string[];
}

async function unseed() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log('Nenhum seed-manifest.json encontrado — nada pra remover.');
    return;
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));

  if (manifest.chatHistoryIds.length) {
    await query(`DELETE FROM public.chat_histories WHERE id = ANY($1::uuid[])`, [manifest.chatHistoryIds]);
    console.log(`🗑️  ${manifest.chatHistoryIds.length} chat_histories removidos`);
  }
  if (manifest.chatSessionIds.length) {
    await query(`DELETE FROM public.chat_sessions WHERE id = ANY($1::uuid[])`, [manifest.chatSessionIds]);
    console.log(`🗑️  ${manifest.chatSessionIds.length} chat_sessions removidos (cascata: chat_messages, participants, viewers)`);
  }
  if (manifest.profileIds.length) {
    await query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [manifest.profileIds]);
    console.log(`🗑️  ${manifest.profileIds.length} profiles removidos (cascata: analyst_status, user_status_history)`);
  }
  if (manifest.queueIds.length) {
    await query(`DELETE FROM public.queues WHERE id = ANY($1::text[])`, [manifest.queueIds]);
    console.log(`🗑️  ${manifest.queueIds.length} queues removidas`);
  }
  if (manifest.whatsappInstanceIds.length) {
    await query(`DELETE FROM public.whatsapp_instances WHERE id = ANY($1::text[])`, [manifest.whatsappInstanceIds]);
    console.log(`🗑️  ${manifest.whatsappInstanceIds.length} whatsapp_instances removidas`);
  }
  if (manifest.companyIds.length) {
    await query(`DELETE FROM public.companies WHERE id = ANY($1::uuid[])`, [manifest.companyIds]);
    console.log(`🗑️  ${manifest.companyIds.length} companies removidas`);
  }

  fs.unlinkSync(MANIFEST_PATH);
  console.log('✅ Unseed concluído — seed-manifest.json removido.');
}

unseed()
  .catch((err) => {
    console.error('❌ Erro no unseed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
