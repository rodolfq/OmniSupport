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

    // Mesma query de updateCompanyRadarSync
    await client.query(`UPDATE public.companies SET radar_sync = $1 WHERE id = $2`, [true, companyId]);
    console.log('✅ updateCompanyRadarSync (UPDATE) OK');

    // Mesma query de saveCustomerEvaluation
    await client.query(
      `INSERT INTO public.customer_evaluations
         (company_id, analyst_id, chat_session_id, knowledge_score, autonomy_score, learning_score, engagement_score, organization_score, communication_score, profile_tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [companyId, analystId, null, 5, 4, 5, 3, 4, 5, 'technical']
    );
    console.log('✅ saveCustomerEvaluation (INSERT) OK');

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
    if (row.count !== 1) throw new Error(`Esperava count=1, veio ${row.count}`);
    console.log('✅ getCustomerEvaluationSummary (AVG) OK:', JSON.stringify(row));

    const latestRes = await client.query(
      `SELECT knowledge_score, autonomy_score, learning_score, engagement_score, organization_score, communication_score, profile_tag
       FROM public.customer_evaluations
       WHERE company_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [companyId]
    );
    if (latestRes.rows[0].profile_tag !== 'technical') throw new Error('profile_tag não bateu');
    console.log('✅ getCustomerEvaluationSummary (latest) OK:', JSON.stringify(latestRes.rows[0]));

    const companyCheck = await client.query('SELECT radar_sync FROM public.companies WHERE id = $1', [companyId]);
    if (companyCheck.rows[0].radar_sync !== true) throw new Error('radar_sync não persistiu como true');
    console.log('✅ radar_sync persistido corretamente');

    // Mesma query usada pelo endpoint de relatório /api/reports/customer-evaluations
    const reportRes = await client.query(
      `SELECT e.id, c.name AS company_name, a.name AS analyst_name
       FROM public.customer_evaluations e
       LEFT JOIN public.companies c ON c.id = e.company_id
       LEFT JOIN public.profiles a ON a.id = e.analyst_id
       WHERE e.company_id = $1`,
      [companyId]
    );
    if (reportRes.rows.length !== 1 || reportRes.rows[0].company_name !== '__smoke_test_company__' || reportRes.rows[0].analyst_name !== '__smoke_test_analyst__') {
      throw new Error('Query do relatório não retornou a linha esperada: ' + JSON.stringify(reportRes.rows));
    }
    console.log('✅ Query do relatório OK:', JSON.stringify(reportRes.rows[0]));

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
      console.log('🧹 Dados de teste removidos.');
    } catch (cleanupErr: any) {
      console.error('⚠️ Falha ao limpar dados de teste (verificar manualmente):', cleanupErr.message);
    }
    await client.end();
  }
}

run();
