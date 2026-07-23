// Smoke test do GET/PUT de /api/integrations/v1/companies com os novos
// campos (radarSync + resumo de avaliação) e a atualização parcial genérica
// (name/industry/phone/radarSync). Roda a mesma query SQL usada na rota
// (app/api/integrations/v1/companies/route.ts) direto contra o banco real,
// com uma empresa descartável, e limpa tudo no final.
import { Client } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const EVALUATION_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS count,
      AVG(knowledge_score) AS knowledge_avg,
      AVG(autonomy_score) AS autonomy_avg,
      AVG(learning_score) AS learning_avg,
      AVG(engagement_score) AS engagement_avg,
      AVG(organization_score) AS organization_avg,
      AVG(communication_score) AS communication_avg,
      COUNT(*) FILTER (WHERE origin = 'chat_close')::int AS chat_close_count,
      COUNT(*) FILTER (WHERE origin = 'manual')::int AS manual_count
    FROM public.customer_evaluations e
    WHERE e.company_id = c.id
  ) ev ON true
  LEFT JOIN LATERAL (
    SELECT profile_tag
    FROM public.customer_evaluations e2
    WHERE e2.company_id = c.id
    ORDER BY e2.created_at DESC
    LIMIT 1
  ) lt ON true
`;

const COMPANY_SELECT = `
  SELECT
    c.id, c.name, c.industry, c.phone, c.radar_sync,
    COALESCE(ev.count, 0) AS eval_count,
    ev.knowledge_avg, ev.autonomy_avg, ev.learning_avg, ev.engagement_avg, ev.organization_avg, ev.communication_avg,
    COALESCE(ev.chat_close_count, 0) AS chat_close_count,
    COALESCE(ev.manual_count, 0) AS manual_count,
    lt.profile_tag AS latest_tag
  FROM public.companies c
  ${EVALUATION_JOIN}
`;

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let companyId: string | null = null;
  let analystId: string | null = null;
  try {
    await client.connect();

    const companyRes = await client.query(
      `INSERT INTO public.companies (name, industry, phone) VALUES ($1, 'Teste', '11999999999') RETURNING id`,
      ['__smoke_test_integration_company__']
    );
    companyId = companyRes.rows[0].id;
    console.log('✅ Empresa de teste criada:', companyId);

    const analystRes = await client.query(
      `INSERT INTO public.profiles (name, email, role, password) VALUES ($1, $2, 'Equipe', 'x') RETURNING id`,
      ['__smoke_test_integration_analyst__', `smoke_test_integration_${Date.now()}@example.invalid`]
    );
    analystId = analystRes.rows[0].id;
    console.log('✅ Analista de teste criado:', analystId);

    // Sem avaliações ainda — confirma que os LEFT JOIN LATERAL não quebram
    // com zero linhas (eval_count deve vir 0 via COALESCE, não null).
    const emptyRes = await client.query(`${COMPANY_SELECT} WHERE c.id = $1`, [companyId]);
    const emptyRow = emptyRes.rows[0];
    if (Number(emptyRow.eval_count) !== 0) throw new Error(`Esperava eval_count=0 sem avaliações, veio ${emptyRow.eval_count}`);
    if (emptyRow.latest_tag !== null) throw new Error('latest_tag deveria ser null sem avaliações');
    if (emptyRow.radar_sync !== false && emptyRow.radar_sync !== null) throw new Error('radar_sync deveria começar false/null');
    console.log('✅ GET companies sem avaliações OK (eval_count=0, latest_tag=null)');

    // Mesma query do PUT (atualização parcial via COALESCE) — só envia
    // radarSync, name/industry/phone devem permanecer intactos.
    const partialUpdate = async (name: string | null, industry: string | null, phone: string | null, radarSync: boolean | null) => {
      return client.query(
        `UPDATE public.companies
         SET name = COALESCE($1, name),
             industry = COALESCE($2, industry),
             phone = COALESCE($3, phone),
             radar_sync = COALESCE($4, radar_sync)
         WHERE id = $5
         RETURNING name, industry, phone, radar_sync`,
        [name, industry, phone, radarSync, companyId]
      );
    };

    const putRes = await partialUpdate(null, null, null, true);
    if (putRes.rowCount !== 1) throw new Error('PUT radar_sync não afetou 1 linha');
    if (putRes.rows[0].name !== '__smoke_test_integration_company__' || putRes.rows[0].phone !== '11999999999') {
      throw new Error('Atualização parcial de radarSync alterou campos que não deveriam mudar: ' + JSON.stringify(putRes.rows[0]));
    }
    console.log('✅ PUT companies (só radarSync=true) OK, name/phone preservados');

    // Agora só phone — radarSync deve continuar true, não voltar pra false.
    const putPhoneRes = await partialUpdate(null, null, '11888887777', null);
    if (putPhoneRes.rows[0].phone !== '11888887777' || putPhoneRes.rows[0].radar_sync !== true) {
      throw new Error('Atualização parcial de phone não preservou radarSync: ' + JSON.stringify(putPhoneRes.rows[0]));
    }
    console.log('✅ PUT companies (só phone) OK, radarSync preservado como true');

    // radarSync=false explícito precisa flipar de verdade, não ser tratado
    // como "campo ausente" (armadilha comum com `|| null` em boolean).
    const putFalseRes = await partialUpdate(null, null, null, false);
    if (putFalseRes.rows[0].radar_sync !== false) {
      throw new Error('radarSync=false não foi persistido, ficou: ' + putFalseRes.rows[0].radar_sync);
    }
    console.log('✅ PUT companies (radarSync=false explícito) OK, flipou de verdade');

    // Deixa radar_sync=true de novo pra validação do GET abaixo.
    await partialUpdate(null, null, null, true);

    // Duas avaliações: uma completa (chat_close), outra parcial com um
    // critério em branco (manual) — confere que AVG ignora o branco.
    await client.query(
      `INSERT INTO public.customer_evaluations
         (company_id, analyst_id, chat_session_id, knowledge_score, autonomy_score, learning_score, engagement_score, organization_score, communication_score, profile_tag, origin, contact_id)
       VALUES ($1, $2, NULL, 5, 4, 5, 3, 4, 5, 'technical', 'chat_close', NULL)`,
      [companyId, analystId]
    );
    await client.query(
      `INSERT INTO public.customer_evaluations
         (company_id, analyst_id, chat_session_id, knowledge_score, autonomy_score, learning_score, engagement_score, organization_score, communication_score, profile_tag, origin, contact_id)
       VALUES ($1, $2, NULL, NULL, 3, 3, 3, 3, 3, 'beginner', 'manual', NULL)`,
      [companyId, analystId]
    );
    console.log('✅ 2 avaliações de teste inseridas (1 chat_close completa, 1 manual com critério em branco)');

    const filledRes = await client.query(`${COMPANY_SELECT} WHERE c.id = $1`, [companyId]);
    const row = filledRes.rows[0];
    if (row.radar_sync !== true) throw new Error('radar_sync não persistiu como true');
    if (Number(row.eval_count) !== 2) throw new Error(`Esperava eval_count=2, veio ${row.eval_count}`);
    if (Number(row.knowledge_avg) !== 5) throw new Error(`Esperava knowledge_avg=5 (só 1 avaliação respondeu), veio ${row.knowledge_avg}`);
    if (Number(row.autonomy_avg) !== 3.5) throw new Error(`Esperava autonomy_avg=3.5, veio ${row.autonomy_avg}`);
    if (row.latest_tag !== 'beginner') throw new Error(`Esperava latest_tag='beginner' (mais recente), veio ${row.latest_tag}`);
    if (Number(row.chat_close_count) !== 1 || Number(row.manual_count) !== 1) {
      throw new Error(`countByOrigin não bateu: chat_close=${row.chat_close_count}, manual=${row.manual_count}`);
    }
    console.log('✅ GET companies com avaliações OK (radarSync, médias, latestTag, countByOrigin):', JSON.stringify({
      radar_sync: row.radar_sync,
      eval_count: row.eval_count,
      knowledge_avg: row.knowledge_avg,
      autonomy_avg: row.autonomy_avg,
      latest_tag: row.latest_tag,
      chat_close_count: row.chat_close_count,
      manual_count: row.manual_count,
    }));

    // Lista completa (sem WHERE id) também precisa incluir a empresa de teste.
    const listRes = await client.query(`${COMPANY_SELECT} ORDER BY c.name ASC`);
    const found = listRes.rows.find((r: any) => r.id === companyId);
    if (!found) throw new Error('Empresa de teste não apareceu na listagem geral');
    console.log('✅ Listagem geral (sem id) inclui a empresa de teste com os novos campos');

    console.log('\n🎉 TODOS OS TESTES PASSARAM');
  } catch (err: any) {
    console.error('\n❌ FALHOU:', err.message);
    process.exitCode = 1;
  } finally {
    try {
      if (companyId) await client.query('DELETE FROM public.companies WHERE id = $1', [companyId]);
      if (analystId) await client.query('DELETE FROM public.profiles WHERE id = $1', [analystId]);
      console.log('🧹 Dados de teste removidos.');
    } catch (cleanupErr: any) {
      console.error('⚠️ Falha ao limpar dados de teste (verificar manualmente):', cleanupErr.message);
    }
    await client.end();
  }
}

run();
