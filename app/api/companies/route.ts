import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool, query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { logAudit } from '@/lib/audit-log';
import { getCurrentActionUser } from '@/lib/server-auth';
import type { CustomerEvaluationScores } from '@/lib/types';

/**
 * Empresas-cliente e avaliação interna do cliente.
 *
 * Reúne o que existia aqui com as Server Actions saveCompany /
 * setCompanyActive / deleteCompany / getCompanies / updateCompanyTraining /
 * saveCustomerEvaluation / getCustomerEvaluationSummary, migradas na separação
 * front/back.
 *
 * AUTORIZAÇÃO — mudança relevante em relação à versão anterior desta rota:
 * POST, PUT e DELETE aqui NÃO checavam nada. Qualquer sessão autenticada podia
 * criar, renomear e EXCLUIR empresa; o DELETE nem tinha a trava de "empresa com
 * pessoas vinculadas" que a Server Action tinha. Como o middleware só confirma
 * que existe sessão válida (ver middleware.ts), na prática um Funcionário podia
 * apagar a empresa de outro cliente. Agora cada operação confere o papel, e as
 * regras são as mesmas que estavam nas actions.
 */

const REFERENCE_CACHE_HEADER = 'private, max-age=30, stale-while-revalidate=300';

function somenteAdministrador(actor: any) {
  return actor && actor.role === 'Administrador';
}

export async function GET(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const tipo = searchParams.get('tipo');
  const isCompanyUser = actor.role === 'Cliente' || actor.role === 'Funcionário';

  try {
    // ------------------------------------------- resumo de avaliação interna
    // Média por critério + tag mais recente, para o cadastro da empresa. Não
    // lista cada avaliação (isso é o relatório).
    if (tipo === 'evaluation-summary') {
      const companyId = searchParams.get('companyId');
      if (!companyId) return NextResponse.json({ error: 'companyId é obrigatório.' }, { status: 400 });
      // Avaliação é perfil INTERNO do cliente: nunca exposta a quem é da
      // própria empresa avaliada.
      if (isCompanyUser) return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });

      const avgRes = await query(
        `SELECT COUNT(*)::int AS count,
                AVG(knowledge_score) AS knowledge_avg,
                AVG(autonomy_score) AS autonomy_avg,
                AVG(learning_score) AS learning_avg,
                AVG(engagement_score) AS engagement_avg,
                AVG(organization_score) AS organization_avg,
                AVG(communication_score) AS communication_avg
           FROM public.customer_evaluations WHERE company_id = $1`,
        [companyId]
      );
      const row = avgRes.rows[0];
      const count = row?.count || 0;

      const originRes = count > 0
        ? await query(
            'SELECT origin, COUNT(*)::int AS count FROM public.customer_evaluations WHERE company_id = $1 GROUP BY origin',
            [companyId]
          )
        : { rows: [] as any[] };
      const countByOrigin = { chatClose: 0, manual: 0 };
      for (const r of originRes.rows) {
        if (r.origin === 'chat_close') countByOrigin.chatClose = r.count;
        else if (r.origin === 'manual') countByOrigin.manual = r.count;
      }

      const latestRes = count > 0
        ? await query(
            `SELECT knowledge_score, autonomy_score, learning_score, engagement_score,
                    organization_score, communication_score, profile_tag
               FROM public.customer_evaluations
              WHERE company_id = $1
              ORDER BY created_at DESC LIMIT 1`,
            [companyId]
          )
        : { rows: [] as any[] };
      const latestRow = latestRes.rows[0];

      // AVG do Postgres já ignora linha com aquele critério em branco (NULL).
      // O cuidado é não confundir "ninguém avaliou esse critério" (NULL) com
      // nota 0 — que não existe na escala.
      const toAvgOrNull = (v: any) => (v === null ? null : Number(v));
      const averages: CustomerEvaluationScores = {
        knowledgeScore: toAvgOrNull(row?.knowledge_avg),
        autonomyScore: toAvgOrNull(row?.autonomy_avg),
        learningScore: toAvgOrNull(row?.learning_avg),
        engagementScore: toAvgOrNull(row?.engagement_avg),
        organizationScore: toAvgOrNull(row?.organization_avg),
        communicationScore: toAvgOrNull(row?.communication_avg)
      };
      const rated = Object.values(averages).filter((v): v is number => v !== null);
      const overallAverage = rated.length > 0 ? rated.reduce((s, v) => s + v, 0) / rated.length : 0;

      return NextResponse.json({
        count,
        averages,
        overallAverage,
        latestProfileTag: latestRow?.profile_tag || null,
        latest: latestRow ? {
          knowledgeScore: latestRow.knowledge_score,
          autonomyScore: latestRow.autonomy_score,
          learningScore: latestRow.learning_score,
          engagementScore: latestRow.engagement_score,
          organizationScore: latestRow.organization_score,
          communicationScore: latestRow.communication_score
        } : null,
        countByOrigin
      });
    }

    // ------------------------------------------------------- empresa por id
    if (id) {
      // Cliente/Funcionário só enxergam a própria empresa.
      if (isCompanyUser && id !== actor.company_id) {
        return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
      }
      const res = await query(
        `SELECT id, name, industry, phone,
                is_in_training AS "isInTraining",
                is_active AS "isActive"
           FROM public.companies WHERE id = $1`,
        [id]
      );
      if (res.rowCount === 0) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
      const row = res.rows[0];
      // isInTraining é perfil interno: não deve nem trafegar para o navegador
      // de quem é da própria empresa.
      if (isCompanyUser) delete row.isInTraining;
      return NextResponse.json(row, { headers: { 'Cache-Control': REFERENCE_CACHE_HEADER } });
    }

    // ------------------------------------------------------------- listagem
    const res = isCompanyUser
      ? await query('SELECT * FROM public.companies WHERE id = $1 ORDER BY name ASC', [actor.company_id])
      : await query('SELECT * FROM public.companies ORDER BY name ASC');

    return NextResponse.json(
      res.rows.map(c => ({
        id: c.id,
        name: c.name,
        industry: c.industry || '',
        phone: c.phone || '',
        createdAt: c.created_at,
        isInTraining: isCompanyUser ? undefined : (c.is_in_training || false),
        csResponsavelId: c.cs_responsavel_id || undefined,
        comercialResponsavelId: c.comercial_responsavel_id || undefined,
        // Desativadas continuam na lista de propósito: a tela as esconde do uso
        // corrente mas precisa mostrá-las a quem procura. Esconder aqui
        // repetiria o problema que a desativação veio resolver.
        isActive: c.is_active !== false
      })),
      { headers: { 'Cache-Control': REFERENCE_CACHE_HEADER } }
    );
  } catch (error: any) {
    console.error('Error fetching companies:', error);
    return NextResponse.json({ error: 'Erro ao carregar empresas.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

  try {
    const body = await request.json();
    const { action } = body;

    // ------------------------------------------- avaliação interna do cliente
    if (action === 'evaluation') {
      if (actor.role === 'Cliente' || actor.role === 'Funcionário') {
        return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
      }
      const { companyId, analystId, scores, profileTag, chatSessionId, origin = 'manual', contactId } = body;
      await query(
        `INSERT INTO public.customer_evaluations
           (company_id, analyst_id, chat_session_id, knowledge_score, autonomy_score, learning_score,
            engagement_score, organization_score, communication_score, profile_tag, origin, contact_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          companyId, analystId, chatSessionId || null,
          scores.knowledgeScore, scores.autonomyScore, scores.learningScore,
          scores.engagementScore, scores.organizationScore, scores.communicationScore,
          profileTag || null, origin, contactId || null
        ]
      );
      return NextResponse.json({ success: true });
    }

    // -------------------------------------------------- empresa em treinamento
    if (action === 'training') {
      if (actor.role === 'Cliente' || actor.role === 'Funcionário') {
        return NextResponse.json({ error: 'Você não tem permissão para alterar esse dado.' }, { status: 403 });
      }
      const { companyId, isInTraining } = body;
      const company = await query('SELECT name FROM public.companies WHERE id = $1', [companyId]);
      await query('UPDATE public.companies SET is_in_training = $1 WHERE id = $2', [isInTraining, companyId]);
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'update',
        entityType: 'company', entityId: companyId,
        entityLabel: company.rows[0]?.name || null, changes: { isInTraining }
      });
      return NextResponse.json({ success: true });
    }

    // ------------------------------------------------- ativar / desativar
    if (action === 'set-active') {
      if (!somenteAdministrador(actor)) {
        return NextResponse.json({ error: 'Você não tem permissão para gerenciar empresas.' }, { status: 403 });
      }
      const { id, active } = body;
      const res = await query(
        'UPDATE public.companies SET is_active = $2 WHERE id = $1 RETURNING name, is_active',
        [id, active]
      );
      if (res.rowCount === 0) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'update',
        entityType: 'company', entityId: id, entityLabel: res.rows[0].name,
        changes: { isActive: active }
      });
      return NextResponse.json({ success: true, isActive: res.rows[0].is_active });
    }

    // --------------------------------------------- criar / atualizar empresa
    //
    // Duas permissões diferentes de propósito:
    //  - CRIAR empresa simples (só nome/setor/telefone) é ação de atendimento:
    //    sai do "Criar e vincular" no chat, quando aparece um cliente que ainda
    //    não está cadastrado. Liberada a papéis de equipe.
    //  - EDITAR empresa existente, ou criar já com usuário administrador, é
    //    ação de cadastro: só Administrador do sistema.
    //
    // Antes desta rota ganhar autorização, QUALQUER sessão fazia as duas —
    // inclusive Cliente/Funcionário, que podiam renomear ou apagar a empresa
    // de outro cliente.
    const { id, name, industry, phone, adminUser, csResponsavelId, comercialResponsavelId } = body;
    const ehPapelDeEquipe = ['Administrador', 'Equipe', 'Time Interno'].includes(actor.role);
    const exigeAdministrador = !!id || !!adminUser;

    if (exigeAdministrador ? !somenteAdministrador(actor) : !ehPapelDeEquipe) {
      return NextResponse.json({ error: 'Você não tem permissão para gerenciar empresas.' }, { status: 403 });
    }
    if (!name?.trim()) return NextResponse.json({ error: 'Nome da empresa é obrigatório.' }, { status: 400 });

    const dup = id
      ? await query('SELECT id FROM public.companies WHERE name = $1 AND id != $2', [name, id])
      : await query('SELECT id FROM public.companies WHERE name = $1', [name]);
    if ((dup.rowCount ?? 0) > 0) {
      return NextResponse.json({ error: 'Empresa com este nome já existe.' }, { status: 409 });
    }

    if (id) {
      await query(
        `UPDATE public.companies
            SET name = $1, industry = $2, phone = $3,
                cs_responsavel_id = $4, comercial_responsavel_id = $5
          WHERE id = $6`,
        [name, industry, phone, csResponsavelId || null, comercialResponsavelId || null, id]
      );
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'update',
        entityType: 'company', entityId: id, entityLabel: name,
        changes: { name, industry, phone, csResponsavelId, comercialResponsavelId }
      });
      return NextResponse.json({ id });
    }

    // Criação simples, sem usuário administrador — é o caminho do "Criar e
    // vincular" no chat, onde só se sabe o nome do cliente. O cadastro
    // completo (com admin) continua sendo feito pela tela de Empresas.
    if (!adminUser) {
      const res = await query(
        `INSERT INTO public.companies (name, industry, phone)
         VALUES ($1, $2, $3)
         RETURNING id, name, industry, phone`,
        [name, industry || null, phone || null]
      );
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'create',
        entityType: 'company', entityId: res.rows[0].id, entityLabel: name
      });
      return NextResponse.json(res.rows[0]);
    }

    if (!adminUser?.name?.trim() || !adminUser?.email?.trim() || !adminUser?.password?.trim()) {
      return NextResponse.json(
        { error: 'Informe nome, e-mail e senha do administrador da empresa.' },
        { status: 400 }
      );
    }

    const emailCheck = await query('SELECT id FROM public.profiles WHERE email = $1', [adminUser.email.trim()]);
    if ((emailCheck.rowCount ?? 0) > 0) {
      return NextResponse.json({ error: 'Usuário administrador com este e-mail já existe.' }, { status: 409 });
    }

    const newId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    const client = await pool.connect();
    try {
      // Empresa e seu administrador nascem JUNTOS: uma falha no meio deixaria
      // uma empresa sem ninguém que consiga entrar nela.
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public.companies (id, name, industry, phone, cs_responsavel_id, comercial_responsavel_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId, name, industry, phone, csResponsavelId || null, comercialResponsavelId || null]
      );
      await client.query(
        `INSERT INTO public.profiles
           (id, email, name, role, company_id, phone, password, is_admin, lives_in_squad,
            must_change_password, view_all_company_tickets)
         VALUES ($1, $2, $3, 'Cliente', $4, $5, $6, TRUE, FALSE, FALSE, TRUE)`,
        [adminId, adminUser.email.trim(), adminUser.name.trim(), newId,
         adminUser.phone || phone || null, hashPassword(adminUser.password)]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'create',
      entityType: 'company', entityId: newId, entityLabel: name,
      changes: { name, industry, phone, adminEmail: adminUser.email.trim() }
    });
    return NextResponse.json({ id: newId });
  } catch (error: any) {
    console.error('Error in companies POST:', error);
    return NextResponse.json({ error: 'Erro ao salvar empresa no servidor.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const actor = await getCurrentActionUser();
  if (!somenteAdministrador(actor)) {
    return NextResponse.json({ error: 'Você não tem permissão para excluir empresas.' }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID da empresa é obrigatório.' }, { status: 400 });

  try {
    const existing = await query('SELECT name FROM public.companies WHERE id = $1', [id]);

    // profiles.company_id é ON DELETE SET NULL: excluir a empresa NÃO apaga as
    // pessoas dela — deixa cada uma SEM empresa. E como a tela Empresas lista
    // pessoas dentro do card de uma empresa, quem fica sem empresa desaparece
    // da interface, sem erro nenhum, ainda que siga no banco com todo o
    // histórico. Foi o que aconteceu com a empresa de exemplo do schema, e o
    // contato dela virou invisível com 14 chamados atrelados.
    const vinculados = await query('SELECT COUNT(*)::int AS total FROM public.profiles WHERE company_id = $1', [id]);
    const total = vinculados.rows[0]?.total || 0;
    if (total > 0) {
      return NextResponse.json({
        error: `Esta empresa tem ${total} pessoa(s) vinculada(s). `
          + 'Mova-as para outra empresa (ou exclua os cadastros) antes de excluir a empresa — '
          + 'excluí-la agora deixaria essas pessoas sem empresa e invisíveis na tela.'
      }, { status: 409 });
    }

    await query('DELETE FROM public.companies WHERE id = $1', [id]);
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'delete',
      entityType: 'company', entityId: id, entityLabel: existing.rows[0]?.name || null
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in companies DELETE:', error);
    return NextResponse.json({ error: 'Erro ao excluir empresa no servidor.' }, { status: 500 });
  }
}
