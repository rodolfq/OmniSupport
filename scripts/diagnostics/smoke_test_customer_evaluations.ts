// Smoke test da feature de avaliação interna de empresa-cliente: roda as
// mesmas queries SQL usadas pelas server actions (app/actions.ts) contra o
// banco real, usando uma empresa e um analista descartáveis criados só pra
// esse teste, e limpa tudo no final (sucesso ou erro). Usa pg.Client direto
// (não importa app/actions.ts) pra não esbarrar em path alias/ESM do Next.
import { Client } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let companyId: string | null = null;
  let analystId: string | null = null;
  let contactId: string | null = null;
  try {
    await client.connect();

    const companyRes = await client.query(
      `INSERT INTO public.companies (name, industry, phone) VALUES ($1, 'Teste', '11999999999') RETURNING id`,
      ['__smoke_test_company__']
    );
    companyId = companyRes.rows[0].id;
    console.log('✅ Empresa de teste criada:', companyId);

    const analystRes = await client.query(
      `INSERT INTO public.profiles (name, email, role, password) VALUES ($1, $2, 'Equipe', 'x') RETURNING id`,
      ['__smoke_test_analyst__', `smoke_test_${Date.now()}@example.invalid`]
    );
    analystId = analystRes.rows[0].id;
    console.log('✅ Analista de teste criado:', analystId);

    const contactRes = await client.query(
      `INSERT INTO public.profiles (name, email, role, password) VALUES ($1, $2, 'Cliente', 'x') RETURNING id`,
      ['__smoke_test_contact__', `smoke_test_contact_${Date.now()}@example.invalid`]
    );
    contactId = contactRes.rows[0].id;
    console.log('✅ Contato de teste criado:', contactId);

    // Mesma query de updateCompanyRadarSync
    await client.query(`UPDATE public.companies SET radar_sync = $1 WHERE id = $2`, [true, companyId]);
    console.log('✅ updateCompanyRadarSync (UPDATE) OK');

    // Mesma query de saveCustomerEvaluation — uma vinda de chat_close (com contato) e outra manual (sem)
    await client.query(
      `INSERT INTO public.customer_evaluations
         (company_id, analyst_id, chat_session_id, knowledge_score, autonomy_score, learning_score, engagement_score, organization_score, communication_score, profile_tag, origin, contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [companyId, analystId, null, 5, 4, 5, 3, 4, 5, 'technical', 'chat_close', contactId]
    );
    await client.query(
      `INSERT INTO public.customer_evaluations
         (company_id, analyst_id, chat_session_id, knowledge_score, autonomy_score, learning_score, engagement_score, organization_score, communication_score, profile_tag, origin, contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [companyId, analystId, null, 3, 3, 3, 3, 3, 3, null, 'manual', null]
    );
    console.log('✅ saveCustomerEvaluation (INSERT x2, chat_close + manual) OK');

    // Mesmas queries de getCustomerEvaluationSummary
    const avgRes = await client.query(
      `SELECT
         COUNT(*)::int AS count,
         AVG(knowledge_score) AS knowledge_avg,
         AVG(autonomy_score) AS autonomy_avg,
         AVG(learning_score) AS learning_avg,
         AVG(engagement_score) AS engagement_avg,
         AVG(organization_score) AS organization_avg,
         AVG(communication_score) AS communication_avg
       FROM public.customer_evaluations
       WHERE company_id = $1`,
      [companyId]
    );
    const row = avgRes.rows[0];
    if (row.count !== 2) throw new Error(`Esperava count=2, veio ${row.count}`);
    console.log('✅ getCustomerEvaluationSummary (AVG) OK:', JSON.stringify(row));

    const originRes = await client.query(
      `SELECT origin, COUNT(*)::int AS count FROM public.customer_evaluations WHERE company_id = $1 GROUP BY origin`,
      [companyId]
    );
    const countByOrigin = { chatClose: 0, manual: 0 };
    for (const r of originRes.rows) {
      if (r.origin === 'chat_close') countByOrigin.chatClose = r.count;
      else if (r.origin === 'manual') countByOrigin.manual = r.count;
    }
    if (countByOrigin.chatClose !== 1 || countByOrigin.manual !== 1) {
      throw new Error('countByOrigin não bateu: ' + JSON.stringify(countByOrigin));
    }
    console.log('✅ getCustomerEvaluationSummary (countByOrigin) OK:', JSON.stringify(countByOrigin));

    const latestRes = await client.query(
      `SELECT knowledge_score, autonomy_score, learning_score, engagement_score, organization_score, communication_score, profile_tag
       FROM public.customer_evaluations
       WHERE company_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [companyId]
    );
    if (latestRes.rows[0].profile_tag !== null) throw new Error('profile_tag da mais recente (manual) deveria ser null');
    console.log('✅ getCustomerEvaluationSummary (latest) OK:', JSON.stringify(latestRes.rows[0]));

    const companyCheck = await client.query('SELECT radar_sync FROM public.companies WHERE id = $1', [companyId]);
    if (companyCheck.rows[0].radar_sync !== true) throw new Error('radar_sync não persistiu como true');
    console.log('✅ radar_sync persistido corretamente');

    // Mesma query usada pelo endpoint de relatório /api/reports/customer-evaluations
    const reportRes = await client.query(
      `SELECT e.id, e.origin, c.name AS company_name, a.name AS analyst_name, ct.name AS contact_name
       FROM public.customer_evaluations e
       LEFT JOIN public.companies c ON c.id = e.company_id
       LEFT JOIN public.profiles a ON a.id = e.analyst_id
       LEFT JOIN public.profiles ct ON ct.id = e.contact_id
       WHERE e.company_id = $1
       ORDER BY e.created_at ASC`,
      [companyId]
    );
    if (reportRes.rows.length !== 2) throw new Error('Query do relatório não retornou as 2 linhas esperadas: ' + JSON.stringify(reportRes.rows));
    const [chatCloseRow, manualRow] = reportRes.rows;
    if (chatCloseRow.origin !== 'chat_close' || chatCloseRow.contact_name !== '__smoke_test_contact__') {
      throw new Error('Linha chat_close não bateu: ' + JSON.stringify(chatCloseRow));
    }
    if (manualRow.origin !== 'manual' || manualRow.contact_name !== null) {
      throw new Error('Linha manual não bateu: ' + JSON.stringify(manualRow));
    }
    console.log('✅ Query do relatório OK (origin + contact_name):', JSON.stringify(reportRes.rows));

    // Mesma query de getCompanies (staff) - confere que radarSync viria certo
    const getCompaniesRes = await client.query('SELECT * FROM public.companies WHERE id = $1', [companyId]);
    console.log('✅ getCompanies (SELECT *) OK, radar_sync bruto:', getCompaniesRes.rows[0].radar_sync);

    console.log('\n🎉 TODOS OS TESTES PASSARAM');
  } catch (err: any) {
    console.error('\n❌ FALHOU:', err.message);
    process.exitCode = 1;
  } finally {
    try {
      if (companyId) await client.query('DELETE FROM public.companies WHERE id = $1', [companyId]);
      if (analystId) await client.query('DELETE FROM public.profiles WHERE id = $1', [analystId]);
      if (contactId) await client.query('DELETE FROM public.profiles WHERE id = $1', [contactId]);
      console.log('🧹 Dados de teste removidos.');
    } catch (cleanupErr: any) {
      console.error('⚠️ Falha ao limpar dados de teste (verificar manualmente):', cleanupErr.message);
    }
    await client.end();
  }
}

run();
