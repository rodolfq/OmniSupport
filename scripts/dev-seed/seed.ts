// Gera dados fictícios pra validar visualmente o Dashboard Gerencial e o
// /reports em localhost (pedido do usuário: "colocar uns dados fictícios
// pra ver os dashs bonitos, depois removemos"). Só deve rodar contra um
// banco de TESTE/DEV vazio — nunca produção.
//
// Cada linha criada tem o id capturado e gravado em seed-manifest.json;
// scripts/dev-seed/unseed.ts usa esse arquivo pra apagar exatamente (e só)
// o que este script criou, sem depender de convenção de nome/prefixo (mais
// seguro que um "DELETE WHERE nome LIKE '[SEED]%'").
//
// Uso: npx ts-node scripts/dev-seed/seed.ts

import fs from 'fs';
import path from 'path';
import { query, pool } from '../../lib/db';
import { hashPassword } from '../../lib/auth-utils';

const MANIFEST_PATH = path.join(__dirname, 'seed-manifest.json');

// America/Sao_Paulo é UTC-3 o ano inteiro desde o fim do horário de verão
// (2019) — simplificação segura aqui só porque é um script de seed
// descartável; metrics-service.ts (código de produto) usa conversão de fuso
// de verdade via SQL, não isso.
function spToUtc(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month, day, hour + 3, minute));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function randomBool(probabilityTrue: number): boolean {
  return Math.random() < probabilityTrue;
}

const COMPANY_NAMES = ['Aurora Logística', 'Vetor Sistemas', 'Cedro Alimentos', 'Bravo Engenharia', 'Nortec Software', 'Planalto Varejo'];
const ANALYST_NAMES = ['Marina Costa', 'Rafael Souza', 'Beatriz Lima', 'Thiago Almeida', 'Camila Rocha', 'Diego Fernandes'];
const CUSTOMER_FIRST = ['Ana', 'Bruno', 'Carla', 'Daniel', 'Elisa', 'Felipe', 'Gabriela', 'Hugo', 'Isabela', 'João', 'Larissa', 'Marcelo', 'Natália', 'Otávio', 'Patrícia', 'Rodrigo', 'Sabrina', 'Tiago', 'Vanessa', 'Wesley'];
const CUSTOMER_LAST = ['Silva', 'Pereira', 'Santos', 'Oliveira', 'Ferreira', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Araújo'];

const CUSTOMER_MESSAGES = [
  'Oi, bom dia! Tô com um problema pra acessar o sistema.',
  'Minha nota fiscal não gerou, alguém pode ajudar?',
  'O relatório não tá abrindo aqui, dá uma olhada?',
  'Preciso trocar o cadastro da minha empresa.',
  'A integração parou de funcionar hoje de manhã.',
  'Consigo falar com alguém sobre a fatura deste mês?'
];
const ANALYST_MESSAGES = [
  'Oi! Tudo bem? Já vou verificar isso pra você.',
  'Consegue me mandar o número do pedido/ticket?',
  'Encontrei o problema aqui, já estou corrigindo.',
  'Pronto, já deve estar funcionando — pode testar de novo?',
  'Vou escalar isso pro time responsável, retorno em breve.',
  'Perfeito, ajustado! Qualquer coisa é só chamar.'
];

interface Manifest {
  companyIds: string[];
  profileIds: string[];
  queueIds: string[];
  whatsappInstanceIds: string[];
  chatSessionIds: string[];
  chatHistoryIds: string[];
}

async function seed() {
  const manifest: Manifest = {
    companyIds: [], profileIds: [], queueIds: [], whatsappInstanceIds: [], chatSessionIds: [], chatHistoryIds: []
  };

  console.log('🌱 Criando empresas...');
  const companyIds: string[] = [];
  for (const name of COMPANY_NAMES) {
    const res = await query(
      `INSERT INTO public.companies (name, industry, phone) VALUES ($1, $2, $3) RETURNING id`,
      [name, 'Tecnologia', `551199${randomInt(100000, 999999)}`]
    );
    companyIds.push(res.rows[0].id);
  }
  manifest.companyIds = companyIds;

  console.log('🌱 Buscando perfis de acesso (Administrador/Equipe/Cliente)...');
  const profilesRes = await query(
    `SELECT id, name FROM public.role_permissions WHERE name IN ('Administrador', 'Equipe', 'Cliente') AND internal_team_id IS NULL`
  );
  const accessProfileByName = new Map(profilesRes.rows.map((r: any) => [r.name, r.id]));
  const adminProfileId = accessProfileByName.get('Administrador');
  const equipeProfileId = accessProfileByName.get('Equipe');
  const clienteProfileId = accessProfileByName.get('Cliente');
  if (!adminProfileId || !equipeProfileId) {
    throw new Error('Perfis de acesso "Administrador"/"Equipe" não encontrados — rode schema_postgres.sql antes do seed.');
  }

  console.log('🌱 Criando usuário admin de teste (admin@seedtest.local / admin123)...');
  const adminRes = await query(
    `INSERT INTO public.profiles (name, email, role, is_admin, password, must_change_password, access_profile_id)
     VALUES ($1, $2, 'Administrador', true, $3, false, $4) RETURNING id`,
    ['Admin (seed)', 'admin@seedtest.local', hashPassword('admin123'), adminProfileId]
  );
  manifest.profileIds.push(adminRes.rows[0].id);

  console.log('🌱 Criando analistas...');
  const analystIds: string[] = [];
  for (const name of ANALYST_NAMES) {
    const email = `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')}@seedtest.local`;
    const res = await query(
      `INSERT INTO public.profiles (name, email, role, password, must_change_password, access_profile_id)
       VALUES ($1, $2, 'Equipe', $3, false, $4) RETURNING id`,
      [name, email, hashPassword('equipe123'), equipeProfileId]
    );
    analystIds.push(res.rows[0].id);
  }
  manifest.profileIds.push(...analystIds);

  console.log('🌱 Criando clientes...');
  const customerIds: string[] = [];
  const customerCompanyOf = new Map<string, string>();
  for (const companyId of companyIds) {
    const count = randomInt(3, 6);
    for (let i = 0; i < count; i++) {
      const name = `${randomChoice(CUSTOMER_FIRST)} ${randomChoice(CUSTOMER_LAST)}`;
      const email = `cliente.${customerIds.length}@seedtest.local`;
      const phone = `5511${randomInt(90000, 99999)}${randomInt(1000, 9999)}`;
      const res = await query(
        `INSERT INTO public.profiles (name, email, role, phone, company_id, password, must_change_password, access_profile_id)
         VALUES ($1, $2, 'Cliente', $3, $4, $5, false, $6) RETURNING id`,
        [name, email, phone, companyId, hashPassword('cliente123'), clienteProfileId]
      );
      customerIds.push(res.rows[0].id);
      customerCompanyOf.set(res.rows[0].id, companyId);
    }
  }
  manifest.profileIds.push(...customerIds);

  console.log('🌱 Criando instâncias de WhatsApp e filas...');
  const instanceIds = ['seed-inst-1', 'seed-inst-2'];
  for (const id of instanceIds) {
    await query(
      `INSERT INTO public.whatsapp_instances (id, name, phone, status) VALUES ($1, $2, $3, 'connected')`,
      [id, id === 'seed-inst-1' ? 'Suporte Principal' : 'Suporte N2', `55119${randomInt(1000000, 9999999)}`]
    );
  }
  manifest.whatsappInstanceIds = instanceIds;

  const queueDefs = [
    { id: 'seed-queue-1', name: 'Suporte N1', instanceId: 'seed-inst-1', members: analystIds.slice(0, 4) },
    { id: 'seed-queue-2', name: 'Suporte N2', instanceId: 'seed-inst-2', members: analystIds.slice(4, 6) }
  ];
  for (const q of queueDefs) {
    await query(
      `INSERT INTO public.queues (id, name, whatsapp_instance_id, member_ids, include_internal_chats, routing_strategy)
       VALUES ($1, $2, $3, $4, true, 'round_robin')`,
      [q.id, q.name, q.instanceId, q.members]
    );
  }
  manifest.queueIds = queueDefs.map(q => q.id);

  console.log('🌱 Gerando histórico de status dos analistas (últimos 90 dias, dias úteis)...');
  const today = new Date();
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  for (const analystId of analystIds) {
    const rows: { status: string; timestamp: Date }[] = [];
    const cursor = new Date(ninetyDaysAgo);
    while (cursor <= today) {
      const dow = cursor.getUTCDay();
      if (dow !== 0 && dow !== 6 && randomBool(0.9)) {
        const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth(), d = cursor.getUTCDate();
        rows.push({ status: 'online', timestamp: spToUtc(y, m, d, 9, randomInt(0, 20)) });
        rows.push({ status: 'away', timestamp: spToUtc(y, m, d, 12, randomInt(0, 15)) });
        rows.push({ status: 'online', timestamp: spToUtc(y, m, d, 13, randomInt(0, 20)) });
        rows.push({ status: 'offline', timestamp: spToUtc(y, m, d, 18, randomInt(0, 30)) });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (rows.length) {
      const values: string[] = [];
      const params: any[] = [];
      rows.forEach((r, i) => {
        params.push(analystId, r.status, r.timestamp);
        values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
      });
      await query(`INSERT INTO public.user_status_history (user_id, status, timestamp) VALUES ${values.join(', ')}`, params);
    }
  }

  console.log('🌱 Marcando estado atual dos analistas (analyst_status)...');
  // Fila "Suporte N2" fica de propósito sem ninguém online agora — pra
  // demonstrar o alerta "Fila sem nenhum membro online" no dashboard.
  for (let i = 0; i < analystIds.length; i++) {
    const isQueue2Member = queueDefs[1].members.includes(analystIds[i]);
    const isOnline = isQueue2Member ? false : randomBool(0.7);
    await query(
      `INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load)
       VALUES ($1, $2, NOW(), 0)
       ON CONFLICT (user_id) DO UPDATE SET is_online = EXCLUDED.is_online, last_active = NOW()`,
      [analystIds[i], isOnline]
    );
  }

  console.log('🌱 Gerando conversas (chat_sessions/chat_messages/chat_histories)...');
  const TOTAL_SESSIONS = 260;
  let created = 0;
  for (let i = 0; i < TOTAL_SESSIONS; i++) {
    const daysAgo = randomInt(0, 178); // até ~6 meses atrás
    const isLiveNow = i < 10; // últimas 10 sessões ficam "vivas" (waiting/active) pros KPIs ao vivo
    const sessionDate = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const dow = sessionDate.getUTCDay();
    if (!isLiveNow && (dow === 0 || dow === 6) && randomBool(0.8)) continue; // pouco volume em fim de semana, de propósito

    const y = sessionDate.getUTCFullYear(), m = sessionDate.getUTCMonth(), d = sessionDate.getUTCDate();
    const startedAt = isLiveNow
      ? new Date(today.getTime() - randomInt(1, 40) * 60 * 1000)
      : spToUtc(y, m, d, randomInt(8, 19), randomInt(0, 59));

    const customerId = randomChoice(customerIds);
    const companyId = customerCompanyOf.get(customerId)!;
    const queue = randomChoice(queueDefs);
    const assigneeId = randomChoice(queue.members);

    const status = isLiveNow ? randomChoice(['waiting', 'waiting', 'active']) : 'closed';
    const willAbandon = !isLiveNow && randomBool(0.06);

    const sessionRes = await query(
      `INSERT INTO public.chat_sessions (customer_id, customer_name, customer_phone, assignee_id, queue_id, status, created_at, updated_at, last_message_at)
       VALUES ($1, $2, (SELECT phone FROM public.profiles WHERE id = $1), $3, $4, $5, $6, $6, $6)
       RETURNING id`,
      [customerId, null, status === 'waiting' ? null : assigneeId, queue.id, status, startedAt]
    );
    const sessionId = sessionRes.rows[0].id;
    manifest.chatSessionIds.push(sessionId);
    created++;

    // Mensagens: cliente sempre fala primeiro; analista responde (exceto nos
    // "abandonados"), com atraso variável — a maioria rápida (<2min), uma
    // fatia mais lenta, pra dar variação real às faixas de status dos KPIs.
    let cursorTime = new Date(startedAt);
    await query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, created_at)
       VALUES ($1, $2, NULL, $3, 'text', $4)`,
      [sessionId, customerId, randomChoice(CUSTOMER_MESSAGES), cursorTime]
    );

    // Mensagem de sistema (aviso de fila) — não deve contar como resposta humana.
    cursorTime = new Date(cursorTime.getTime() + 2000);
    await query(
      `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, created_at)
       VALUES ($1, NULL, 'Sistema', 'Você entrou na fila de atendimento.', 'system', $2)`,
      [sessionId, cursorTime]
    );

    let firstResponseSeconds: number | null = null;
    if (status !== 'waiting' && !willAbandon) {
      const delaySeconds = randomBool(0.7) ? randomInt(15, 118) : randomInt(120, 600);
      cursorTime = new Date(startedAt.getTime() + delaySeconds * 1000);
      firstResponseSeconds = delaySeconds;
      await query(
        `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, created_at)
         VALUES ($1, $2, NULL, $3, 'text', $4)`,
        [sessionId, assigneeId, randomChoice(ANALYST_MESSAGES), cursorTime]
      );

      const extraMessages = randomInt(0, 6);
      for (let k = 0; k < extraMessages; k++) {
        cursorTime = new Date(cursorTime.getTime() + randomInt(20, 300) * 1000);
        const fromCustomer = k % 2 === 0;
        await query(
          `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, created_at)
           VALUES ($1, $2, NULL, $3, 'text', $4)`,
          [sessionId, fromCustomer ? customerId : assigneeId, randomChoice(fromCustomer ? CUSTOMER_MESSAGES : ANALYST_MESSAGES), cursorTime]
        );
      }
    }

    if (status === 'closed') {
      const durationSeconds = Math.max(60, Math.round((cursorTime.getTime() - startedAt.getTime()) / 1000) + randomInt(30, 300));
      const finishedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
      const ratingRoll = Math.random();
      const rating = ratingRoll < 0.55 ? 1 : ratingRoll < 0.70 ? -1 : ratingRoll < 0.80 ? 0 : null;

      const historyRes = await query(
        `INSERT INTO public.chat_histories (session_id, customer_id, customer_name, customer_phone, assignee_id, started_at, finished_at, duration_seconds, first_response_seconds, rating, transcript)
         VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [sessionId, customerId, assigneeId, startedAt, finishedAt, durationSeconds, firstResponseSeconds, rating, '(transcript de teste — seed)']
      );
      manifest.chatHistoryIds.push(historyRes.rows[0].id);
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`✅ Seed concluído: ${created} conversas, ${companyIds.length} empresas, ${analystIds.length} analistas, ${customerIds.length} clientes.`);
  console.log(`📄 Manifesto salvo em ${MANIFEST_PATH} — usado por unseed.ts pra limpar depois.`);
  console.log(`🔑 Login de teste: admin@seedtest.local / admin123`);
}

seed()
  .catch((err) => {
    console.error('❌ Erro no seed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
