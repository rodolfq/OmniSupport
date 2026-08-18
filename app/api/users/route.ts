import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
// Importado de lib/server-auth.ts e não de app/actions.ts: naquele arquivo
// vale 'use server', onde toda função exportada vira endpoint público — e
// ajudante de autorização não deve ser chamável de fora.
import { getCurrentActionUser, assertUserManageable, getAdminTeamIds } from '@/lib/server-auth';
import { generateAvatarThumb } from '@/lib/services/avatar-thumb-service';
import { canForceOthersOffline } from '@/lib/services/presence-authorization';
import { logAudit } from '@/lib/audit-log';

// Papéis "de equipe" — os únicos que hoje consomem GET/POST desta rota
// (Canais de Atendimento, Filas, Hotfixes, vínculo de contato). Cliente/
// Funcionário nunca deveriam enxergar a lista completa de usuários do
// sistema nem criar contas por aqui.
const STAFF_ROLES = ['Administrador', 'Equipe', 'Time Interno'];

export async function GET(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';

  // `scoped` é a ÚNICA leitura liberada a Cliente/Funcionário, e mesmo assim
  // filtrada pela empresa deles dentro do próprio branch. Todas as demais
  // devolvem a lista completa de usuários do sistema e continuam restritas a
  // papéis de equipe — foi por isso que o guarda saiu do topo do handler:
  // liberar `scoped` sem separar os casos abriria as outras junto.
  if (type !== 'scoped' && !STAFF_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
  }

  try {
    if (type === 'lite') {
      // Sem avatar_url de propósito: a tabela tem ~51MB de fotos em base64
      // (sync do Bitrix24) — bom pra tela de Equipe mostrar foto, péssimo
      // pra dropdown de filtro/responsável que só precisa de id/nome/role.
      // avatar_thumb_url é a exceção: já nasce pequena (ver
      // lib/services/avatar-thumb-service.ts), por isso pode ir aqui e
      // alimentar o avatar do responsável nas listas de Chamados/Tickets
      // Internos sem reintroduzir o mesmo problema de peso.
      // Usada por lib/query-hooks.ts (useProfilesLiteQuery), compartilhada
      // entre filter-bar.tsx e modern-search-bar.tsx.
      const res = await query(
        'SELECT id, name, email, role, company_id, is_admin, internal_team_ids, avatar_thumb_url FROM public.profiles'
      );
      return NextResponse.json(res.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        companyId: r.company_id,
        isAdmin: r.is_admin,
        internalTeamIds: r.internal_team_ids,
        avatarThumbUrl: r.avatar_thumb_url
      })));
    } else if (type === 'scoped') {
      // Lista com ESCOPO PELO ATOR — substitui a Server Action getUsers.
      // Cliente/Funcionário só enxergam gente da própria empresa; o resto vê
      // todo mundo. É o único GET desta rota com esse recorte, e por isso
      // precisa existir separado de `type=all`.
      const isCompanyUser = actor.role === 'Cliente' || actor.role === 'Funcionário';
      const COLUMNS = `id, name, email, role, company_id, phone, view_all_company_tickets,
                       is_admin, is_active, internal_team_ids, access_profile_id,
                       avatar_thumb_url,
                       (avatar_url IS NOT NULL AND avatar_url <> '') AS has_avatar`;
      const res = isCompanyUser
        ? await query(
            `SELECT ${COLUMNS} FROM public.profiles
              WHERE company_id = $1 AND role IN ('Cliente', 'Funcionário') ORDER BY name ASC`,
            [actor.company_id]
          )
        : await query(`SELECT ${COLUMNS} FROM public.profiles ORDER BY name ASC`);

      return NextResponse.json(res.rows.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        companyId: u.company_id,
        phone: u.phone || undefined,
        avatarUrl: u.has_avatar ? `/api/users/${u.id}/avatar` : undefined,
        avatarThumbUrl: u.avatar_thumb_url || undefined,
        viewAllCompanyTickets: u.view_all_company_tickets,
        isAdmin: u.is_admin,
        isActive: u.is_active,
        internalTeamIds: u.internal_team_ids || [],
        accessProfileId: u.access_profile_id || undefined
      })));
    } else if (type === 'analysts-basic') {
      // Substitui getAnalysts. Colunas explícitas: com `*` o banco ainda
      // mandaria avatar_url (base64) ao servidor só para montar uma lista de
      // nomes — ~50 MB desperdiçados.
      const res = await query(
        `SELECT id, name, email, role, company_id, phone
           FROM public.profiles
          WHERE role IN ('Administrador', 'Equipe', 'Time Interno')
          ORDER BY name ASC`
      );
      return NextResponse.json(res.rows.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        companyId: u.company_id, phone: u.phone || undefined
      })));
    } else if (type === 'customers') {
      // Substitui getCustomers.
      const res = await query(
        `SELECT id, name, email, role, company_id, phone
           FROM public.profiles
          WHERE role IN ('Cliente', 'Funcionário')
          ORDER BY name ASC`
      );
      return NextResponse.json(res.rows.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        companyId: u.company_id, phone: u.phone || undefined
      })));
    } else if (type === 'chat-team') {
      // Pessoas que aparecem no chat interno: papéis de equipe, com presença.
      // avatarUrl é o ENDEREÇO da foto (a conversa mostra o avatar em tamanho
      // maior, onde a miniatura de 48px não serve) e a miniatura vem junto pra
      // lista de salas desenhar sem esperar requisição — ver
      // app/api/users/[id]/avatar/route.ts.
      const res = await query(
        `SELECT id, name, email, role, status, status_reason, avatar_thumb_url,
                (avatar_url IS NOT NULL AND avatar_url <> '') AS has_avatar
           FROM public.profiles
          WHERE role IN ('Equipe', 'Administrador', 'Time Interno')
          ORDER BY name ASC`
      );
      return NextResponse.json(res.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        status: r.status,
        statusReason: r.status_reason,
        avatarUrl: r.has_avatar ? `/api/users/${r.id}/avatar` : null,
        avatarThumbUrl: r.avatar_thumb_url
      })));
    } else if (type === 'employees') {
      const res = await query(
        "SELECT id, name, email, role, company_id, phone FROM public.profiles WHERE role = 'Cliente' OR role = 'Funcionário'"
      );
      return NextResponse.json(res.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        companyId: r.company_id,
        phone: r.phone
      })));
    } else if (type === 'analysts') {
      // A foto NÃO vem por padrão. `avatar_url` guarda a imagem inteira como
      // `data:` URL em base64 (é assim que o sync do Bitrix24 grava), e a
      // equipe inteira soma dezenas de MB — a maior foto sozinha passa de 2MB.
      // Quase todos os consumidores só querem `id` + `name` pra preencher um
      // <select> ou resolver o nome de um responsável; baixar as fotos deixava
      // telas de dados triviais (Hotfixes, Empresas) lentas sem motivo.
      // Quem precisa de foto pede explicitamente com ?withAvatar=1.
      // A miniatura (avatar_thumb_url) vem sempre: ~1,3kB por pessoa, é o que
      // alimenta o avatar em card/lista. Só a foto cheia é opt-in.
      const withAvatar = searchParams.get('withAvatar') === '1';
      const res = await query(
        `SELECT id, name, email, role, company_id, phone, internal_team_ids, avatar_thumb_url,
                (avatar_url IS NOT NULL AND avatar_url <> '') AS has_avatar
         FROM public.profiles WHERE role IN ('Administrador', 'Equipe', 'Time Interno')`
      );
      return NextResponse.json(res.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        companyId: r.company_id,
        phone: r.phone,
        // withAvatar deixou de custar os MB de base64 — agora é só a URL.
        // Mantido como opt-in mesmo assim: quem não pede continua sem o campo,
        // e nenhum consumidor precisou mudar.
        avatarUrl: withAvatar && r.has_avatar ? `/api/users/${r.id}/avatar` : undefined,
        avatarThumbUrl: r.avatar_thumb_url,
        internalTeamIds: r.internal_team_ids
      })));
    } else if (type === 'analysts-search') {
      // Busca paginada com foto — usada pelo seletor de membros de Fila.
      // Ao contrário de `type=analysts` (que traz todo mundo de uma vez),
      // aqui só a página pedida carrega avatar_url, evitando puxar todas as
      // fotos (base64) da equipe inteira quando o admin só quer achar 1 pessoa.
      const idsParam = searchParams.get('ids');
      if (idsParam) {
        const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 0) return NextResponse.json({ items: [] });
        const res = await query(
          `SELECT id, name, email, role, company_id, phone, internal_team_ids,
                  (avatar_url IS NOT NULL AND avatar_url <> '') AS has_avatar
           FROM public.profiles
           WHERE role IN ('Administrador', 'Equipe', 'Time Interno') AND id = ANY($1)`,
          [ids]
        );
        return NextResponse.json({
          items: res.rows.map(r => ({
            id: r.id,
            name: r.name,
            email: r.email,
            role: r.role,
            companyId: r.company_id,
            phone: r.phone,
            avatarUrl: r.has_avatar ? `/api/users/${r.id}/avatar` : null,
            internalTeamIds: r.internal_team_ids
          }))
        });
      }

      const q = (searchParams.get('q') || '').trim();
      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
      const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '9', 10) || 9));
      const offset = (page - 1) * pageSize;
      const likeParam = `%${q}%`;

      const res = await query(
        `SELECT id, name, email, role, company_id, phone, internal_team_ids,
                (avatar_url IS NOT NULL AND avatar_url <> '') AS has_avatar,
                COUNT(*) OVER() AS total_count
         FROM public.profiles
         WHERE role IN ('Administrador', 'Equipe', 'Time Interno')
           AND ($1 = '' OR name ILIKE $2 OR email ILIKE $2)
         ORDER BY name ASC
         LIMIT $3 OFFSET $4`,
        [q, likeParam, pageSize, offset]
      );
      return NextResponse.json({
        items: res.rows.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role,
          companyId: r.company_id,
          phone: r.phone,
          avatarUrl: r.has_avatar ? `/api/users/${r.id}/avatar` : null,
          internalTeamIds: r.internal_team_ids
        })),
        total: res.rows.length > 0 ? parseInt(res.rows[0].total_count, 10) : 0
      });
    } else if (type === 'team-search') {
      // Busca paginada da Gestão da Equipe (Configurações > Equipe). Antes a
      // tela baixava TODO usuário do sistema — inclusive cada cliente/
      // funcionário de cada empresa — só para filtrar 3 papéis no client;
      // aqui o filtro de papel, a busca por nome/e-mail e o recorte por
      // equipe administrada já saem prontos do banco, uma página por vez.
      const isSystemAdmin = actor.role === 'Administrador';
      const adminTeamIds = isSystemAdmin ? [] : await getAdminTeamIds(actor.id);

      const q = (searchParams.get('q') || '').trim();
      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
      const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10) || 20));
      const offset = (page - 1) * pageSize;
      const likeParam = `%${q}%`;

      const res = await query(
        `SELECT id, name, email, role, access_profile_id, avatar_thumb_url,
                (avatar_url IS NOT NULL AND avatar_url <> '') AS has_avatar,
                COUNT(*) OVER() AS total_count
           FROM public.profiles
          WHERE role IN ('Administrador', 'Equipe', 'Time Interno')
            AND ($1::boolean OR internal_team_ids && $2::uuid[])
            AND ($3 = '' OR name ILIKE $4 OR email ILIKE $4)
          ORDER BY name ASC
          LIMIT $5 OFFSET $6`,
        [isSystemAdmin, adminTeamIds, q, likeParam, pageSize, offset]
      );
      return NextResponse.json({
        items: res.rows.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role,
          accessProfileId: r.access_profile_id || undefined,
          avatarUrl: r.has_avatar ? `/api/users/${r.id}/avatar` : undefined,
          avatarThumbUrl: r.avatar_thumb_url || undefined
        })),
        total: res.rows.length > 0 ? parseInt(res.rows[0].total_count, 10) : 0
      });
    } else {
      // avatarUrl aqui é o ENDEREÇO da foto, não a foto. Antes esta listagem
      // devolvia o base64 inteiro de todo mundo: 50,7 MB por carga, em 14
      // telas, pra desenhar avatares de 32 a 56 pixels. Agora vai só a URL
      // (ver app/api/users/[id]/avatar/route.ts) — o <img> continua
      // funcionando igual, com a foto em qualidade cheia, e o navegador busca
      // cada imagem uma vez e reaproveita entre as telas.
      //
      // A miniatura continua vindo embutida (~1,3kB): é ela que faz a lista
      // desenhar na hora, sem esperar uma requisição por avatar.
      // NÃO selecionar avatar_url aqui é metade do ganho — a outra metade é
      // não trafegá-la; a coluna sozinha é ~51 MB no banco.
      const res = await query(
        `SELECT id, name, email, role, company_id, phone, view_all_company_tickets,
                must_change_password, is_admin, avatar_thumb_url, internal_team_ids, is_active,
                (avatar_url IS NOT NULL AND avatar_url <> '') AS has_avatar
           FROM public.profiles`
      );
      return NextResponse.json(res.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        companyId: r.company_id,
        phone: r.phone,
        viewAllCompanyTickets: r.view_all_company_tickets,
        mustChangePassword: r.must_change_password,
        isAdmin: r.is_admin,
        avatarUrl: r.has_avatar ? `/api/users/${r.id}/avatar` : null,
        avatarThumbUrl: r.avatar_thumb_url,
        internalTeamIds: r.internal_team_ids,
        isActive: r.is_active
      })));
    }
  } catch (error: any) {
    console.error('Error fetching users in API:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Ações em que Cliente (dono da empresa-cliente) também entra: ele gerencia os
// Funcionários da PRÓPRIA empresa, e cada uma delas confere isso por dentro
// (create-full recusa papel ou empresa diferente; update-profile passa por
// assertUserManageable). As demais continuam só para papéis de equipe.
const ACOES_ABERTAS_A_CLIENTE = ['create-full', 'update-profile', 'presence'];

export async function POST(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (!ACOES_ABERTAS_A_CLIENTE.includes(action) && !STAFF_ROLES.includes(actor.role)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    // ------------------------------------------------ presença (online/ausente)
    if (action === 'presence') {
      const { userId, isOnline, reason } = body;
      if (!userId) return NextResponse.json({ error: 'userId é obrigatório.' }, { status: 400 });

      // Ninguém coloca OUTRA pessoa como Online — só o próprio usuário decide
      // isso de si mesmo. Forçar um colega para Offline ("derrubar login" de
      // quem ficou preso como disponível) é permitido, mas exige permissão de
      // supervisão. Ver lib/services/presence-authorization.ts: sem esta trava
      // dá para fraudar o rodízio de atendimento.
      if (actor.id !== userId) {
        if (isOnline) {
          return NextResponse.json({ error: 'Só o próprio usuário pode se colocar Online.' }, { status: 403 });
        }
        if (!(await canForceOthersOffline(actor))) {
          return NextResponse.json(
            { error: 'Você não tem permissão para alterar o status de outro usuário.' },
            { status: 403 }
          );
        }
      }

      const status = isOnline ? 'online' : 'offline';
      // queue_anchor_at só é gravada na PRIMEIRA vez que fica online no dia
      // (ver migrations/queue_daily_anchor.sql). Ficar ausente/offline não mexe
      // nela, então a posição no rodízio não se perde.
      await query(
        `INSERT INTO public.analyst_status (user_id, is_online, last_active, current_reason, status, queue_anchor_at, queue_anchor_date)
         VALUES ($1, $2, NOW(), $3, $4, CASE WHEN $2 THEN NOW() END, CASE WHEN $2 THEN CURRENT_DATE END)
         ON CONFLICT (user_id) DO UPDATE SET
           is_online = EXCLUDED.is_online,
           last_active = NOW(),
           current_reason = EXCLUDED.current_reason,
           status = EXCLUDED.status,
           queue_anchor_at = CASE
             WHEN EXCLUDED.is_online AND (analyst_status.queue_anchor_date IS NULL OR analyst_status.queue_anchor_date < CURRENT_DATE)
             THEN NOW() ELSE analyst_status.queue_anchor_at END,
           queue_anchor_date = CASE
             WHEN EXCLUDED.is_online AND (analyst_status.queue_anchor_date IS NULL OR analyst_status.queue_anchor_date < CURRENT_DATE)
             THEN CURRENT_DATE ELSE analyst_status.queue_anchor_date END`,
        [userId, isOnline, reason || null, status]
      );
      await query(
        'INSERT INTO public.user_status_history (user_id, status, reason) VALUES ($1, $2, $3)',
        [userId, status, reason || null]
      );
      return NextResponse.json({ success: true });
    }

    // ------------------------------------- criação COMPLETA (tela de Equipe)
    // Substitui a Server Action createUser. Diferente de `action=create`
    // abaixo, que só cria contato de empresa-cliente: aqui entra a
    // autorização que decide papel, Perfil de Acesso e equipe.
    if (action === 'create-full') {
      const {
        email, name, role, companyId: rawCompanyId, phones = [],
        viewAllCompanyTickets: rawViewAll, accessProfileId, internalTeamIds
      } = body;

      let companyId: string | null = rawCompanyId ?? null;
      let viewAllCompanyTickets: boolean = !!rawViewAll;
      let finalRole = role;
      let finalProfileId: string | null = accessProfileId || null;
      let finalTeamIds: string[] = internalTeamIds || [];

      if (actor.role === 'Cliente') {
        if (role !== 'Funcionário' || companyId !== actor.company_id) {
          return NextResponse.json(
            { error: 'Você só pode criar funcionários da sua própria empresa.' },
            { status: 403 }
          );
        }
        viewAllCompanyTickets = false;
        finalTeamIds = [];
      } else if (actor.role === 'Administrador') {
        // Livre: respeita o que veio do formulário. Se o perfil escolhido é de
        // uma equipe e nenhuma equipe foi informada, herda a do perfil.
        if (finalProfileId && finalTeamIds.length === 0) {
          const p = await query('SELECT internal_team_id FROM public.role_permissions WHERE id = $1', [finalProfileId]);
          if (p.rows[0]?.internal_team_id) finalTeamIds = [p.rows[0].internal_team_id];
        }
      } else {
        // Nem Administrador nem Cliente: só passa se administrar a equipe do
        // perfil escolhido. Papel e equipe vêm SEMPRE do perfil, nunca do que
        // o formulário mandou — é o que impede alguém de se promover a
        // Administrador ou atribuir usuário a outra equipe.
        if (!finalProfileId) {
          return NextResponse.json({ error: 'Você não tem permissão para criar usuários.' }, { status: 403 });
        }
        const p = await query('SELECT internal_team_id, is_system FROM public.role_permissions WHERE id = $1', [finalProfileId]);
        const profile = p.rows[0];
        if (!profile || profile.is_system || !profile.internal_team_id) {
          return NextResponse.json({ error: 'Você só pode atribuir perfis de acesso da sua equipe.' }, { status: 403 });
        }
        const adminTeamIds = await getAdminTeamIds(actor.id);
        if (!adminTeamIds.includes(profile.internal_team_id)) {
          return NextResponse.json({ error: 'Você não administra essa equipe.' }, { status: 403 });
        }
        finalRole = 'Time Interno';
        companyId = null;
        viewAllCompanyTickets = false;
        finalTeamIds = [profile.internal_team_id];
      }

      // Fluxos que só mandam `role` (inclui Cliente criando Funcionário):
      // assume o perfil de sistema correspondente. Sem isso o novo usuário
      // ficaria sem NENHUMA permissão para sempre.
      if (!finalProfileId) {
        const p = await query('SELECT id FROM public.role_permissions WHERE role = $1 AND is_system = true', [finalRole]);
        finalProfileId = p.rows[0]?.id || null;
      }

      // E-mail é OPCIONAL. Vazio vira NULL, nunca string vazia: '' = '' é
      // verdadeiro no índice único, então dois contatos sem e-mail colidiriam.
      const emailNormalizado = typeof email === 'string' && email.trim() ? email.trim() : null;

      if (emailNormalizado) {
        const checkRes = await query(
          `SELECT p.name, p.role, c.name AS company_name
             FROM public.profiles p
             LEFT JOIN public.companies c ON c.id = p.company_id
            WHERE lower(btrim(p.email)) = lower(btrim($1)) LIMIT 1`,
          [emailNormalizado]
        );
        if ((checkRes.rowCount ?? 0) > 0) {
          const dono = checkRes.rows[0];
          const detalhe = [dono.role, dono.company_name].filter(Boolean).join(' — ');
          return NextResponse.json({
            error: `Este e-mail já está em uso por ${dono.name || 'outro cadastro'}`
              + (detalhe ? ` (${detalhe}).` : '.')
          }, { status: 409 });
        }
      }

      const newId = crypto.randomUUID();
      const defaultPass = hashPassword('Mudar@123');
      const isAdmin = finalRole === 'Administrador';
      const livesInSquad = finalRole === 'Administrador' || finalRole === 'Equipe';

      await query(
        `INSERT INTO public.profiles (id, email, name, role, company_id, phone, view_all_company_tickets,
                                      password, is_admin, lives_in_squad, access_profile_id, internal_team_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [newId, emailNormalizado, name, finalRole, companyId || null, phones[0] || null,
         viewAllCompanyTickets, defaultPass, isAdmin, livesInSquad, finalProfileId, finalTeamIds]
      );
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'create',
        entityType: 'user', entityId: newId, entityLabel: name,
        changes: { email, role: finalRole, companyId }
      });
      return NextResponse.json({ id: newId });
    }

    // ------------------------------------ edição de papel / perfil / equipe
    // Substitui a Server Action updateUser. Distinta do PUT desta rota, que é
    // o "salvar cadastro" da tela de funcionário (nome, foto, telefone).
    if (action === 'update-profile') {
      const { id, name, email, role, companyId: rawCompanyId, viewAllCompanyTickets: rawViewAll,
              accessProfileId, internalTeamIds } = body;
      if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

      const check = await assertUserManageable(actor, id);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });
      const target = check.target;

      let companyId = rawCompanyId;
      let viewAllCompanyTickets = rawViewAll;
      let finalRole = role;
      let finalProfileId = accessProfileId;
      let finalTeamIds = internalTeamIds;

      if (actor.role === 'Cliente') {
        finalRole = target.role;               // cliente não muda papel de funcionário
        finalProfileId = target.access_profile_id;
        finalTeamIds = [];
      } else if (actor.role !== 'Administrador') {
        // Admin de equipe: só troca para perfil da própria equipe, não promove
        // a Administrador nem tira alguém da própria equipe. Sem perfil novo
        // (ex.: só corrigindo o nome), PRESERVA o papel atual — forçar
        // 'Time Interno' aqui rebaixaria silenciosamente um 'Equipe' a cada
        // edição.
        if (finalProfileId) {
          const p = await query('SELECT internal_team_id, is_system FROM public.role_permissions WHERE id = $1', [finalProfileId]);
          const profile = p.rows[0];
          const adminTeamIds = await getAdminTeamIds(actor.id);
          if (!profile || profile.is_system || !profile.internal_team_id || !adminTeamIds.includes(profile.internal_team_id)) {
            return NextResponse.json({ error: 'Você só pode atribuir perfis de acesso da sua equipe.' }, { status: 403 });
          }
          finalTeamIds = [profile.internal_team_id];
          finalRole = 'Time Interno';
        } else {
          finalTeamIds = target.internal_team_ids || [];
          finalRole = target.role;
        }
        companyId = target.company_id;
        viewAllCompanyTickets = false;
      } else if (finalProfileId && finalTeamIds === undefined) {
        // Administrador trocando o perfil sem informar equipe: se o perfil é de
        // uma equipe, o usuário passa a fazer parte dela. Sem isso a pessoa
        // ficava com o perfil certo e FORA da equipe para todo o resto do
        // sistema (filtro de tickets internos, listagem de membros).
        const p = await query('SELECT internal_team_id FROM public.role_permissions WHERE id = $1', [finalProfileId]);
        const teamId = p.rows[0]?.internal_team_id;
        if (teamId) {
          const existing: string[] = target.internal_team_ids || [];
          finalTeamIds = existing.includes(teamId) ? existing : [...existing, teamId];
        }
      }

      // `profiles` NÃO tem coluna updated_at (diferente de whatsapp_instances,
      // chat_sessions etc.) — incluí-la aqui derruba o UPDATE inteiro.
      const setClauses = ['name = $1', 'email = $2', 'role = $3', 'company_id = $4', 'view_all_company_tickets = $5'];
      const params: any[] = [name, email, finalRole, companyId || null, !!viewAllCompanyTickets];
      if (finalProfileId !== undefined) { params.push(finalProfileId); setClauses.push(`access_profile_id = $${params.length}`); }
      if (finalTeamIds !== undefined) { params.push(finalTeamIds); setClauses.push(`internal_team_ids = $${params.length}`); }
      params.push(id);

      await query(`UPDATE public.profiles SET ${setClauses.join(', ')} WHERE id = $${params.length}`, params);
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'update',
        entityType: 'user', entityId: id, entityLabel: name,
        changes: { name, email, role: finalRole, companyId }
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'create') {
      const { email, name, companyId, phones } = body;
      // Endpoint simplificado — só cria contato de empresa-cliente (usado
      // hoje por "Vincular contato" no chat). Promover alguém a
      // Administrador/Equipe/Time Interno passa exclusivamente pelo fluxo
      // dedicado (createUser em app/actions.ts, usado pela tela Equipe),
      // nunca por aqui — por isso o role vindo do body é ignorado.
      const safeRole = body.role === 'Cliente' ? 'Cliente' : 'Funcionário';
      const defaultPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = hashPassword(defaultPassword);
      const phone = phones?.[0] || null;

      const res = await query(
        `INSERT INTO public.profiles (email, password, name, role, company_id, phone, is_admin, lives_in_squad)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE, FALSE)
         RETURNING id, name, email, role`,
        [email, hashedPassword, name, safeRole, companyId || null, phone]
      );

      const newUser = res.rows[0];

      return NextResponse.json({
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        companyId,
        phone,
        password: defaultPassword // Retorna em texto plano apenas na criação para exibição do convite
      });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in users POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const { user } = await request.json();
    if (!user || !user.id) {
      return NextResponse.json({ error: 'ID do usuário é obrigatório.' }, { status: 400 });
    }

    let target: any;
    if (actor.id === user.id) {
      const res = await query('SELECT role, company_id, internal_team_ids, is_admin FROM public.profiles WHERE id = $1', [user.id]);
      target = res.rows[0];
      if (!target) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    } else {
      const check = await assertUserManageable(actor, user.id);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });
      target = check.target;
    }

    // role / is_admin / equipes internas / empresa só mudam de verdade se
    // quem está editando for Administrador do sistema — autoedição (ou
    // gerenciar um Funcionário/Cliente da própria empresa) nunca deveria
    // conseguir promover ninguém, nem a si mesmo, a um papel mais
    // privilegiado. Sem essa trava, qualquer usuário autenticado podia virar
    // Administrador só chamando este endpoint com {role:'Administrador'}.
    const isSystemAdmin = actor.role === 'Administrador';
    const role = isSystemAdmin ? (user.role ?? target.role) : target.role;
    const isAdmin = isSystemAdmin ? (user.isAdmin ?? target.is_admin) : target.is_admin;
    const internalTeamIds = isSystemAdmin ? (user.internalTeamIds ?? target.internal_team_ids) : target.internal_team_ids;
    const companyId = isSystemAdmin ? (user.companyId ?? target.company_id) : target.company_id;

    // A LISTAGEM devolve avatarUrl como o endereço de /api/users/<id>/avatar,
    // não mais o base64 (ver o comentário dessa rota). Telas que gravam
    // mandando o objeto de usuário inteiro de volta — link-contact-modal.tsx é
    // a que faz isso hoje — reenviariam essa URL no campo da foto, e gravá-la
    // apagaria a imagem, restando um endereço apontando pra si mesmo.
    //
    // Por isso avatar_url (e a miniatura) só são reescritos quando chega uma
    // IMAGEM de verdade, ou seja, uma `data:` URL. Qualquer outra coisa deixa
    // as duas colunas como estão.
    // E-mail é UNIQUE em profiles. Sem esta checagem, editar um funcionário e
    // pôr um e-mail que já pertence a outra pessoa estourava a constraint, e o
    // catch devolvia a mensagem crua do Postgres
    // ("duplicate key value violates unique constraint profiles_email_key")
    // direto na tela — o modal de edição mostra error.message como está.
    // Comparação sem diferenciar maiúsculas e espaços: para quem usa o sistema
    // "Joao@x.com" e "joao@x.com " são o mesmo e-mail, e deixar passar criaria
    // dois cadastros para a mesma pessoa.
    if (typeof user.email === 'string' && user.email.trim()) {
      // Traz papel e empresa junto do nome: nomes se repetem no sistema (o
      // fluxo "Criar e vincular" de link-contact-modal.tsx cria um perfil novo
      // a cada vinculação, então a mesma pessoa aparece várias vezes), e só o
      // nome não diz QUAL cadastro está com o e-mail.
      const emailEmUso = await query(
        `SELECT p.name, p.role, c.name AS company_name
           FROM public.profiles p
           LEFT JOIN public.companies c ON c.id = p.company_id
          WHERE lower(btrim(p.email)) = lower(btrim($1)) AND p.id <> $2
          LIMIT 1`,
        [user.email, user.id]
      );
      if (emailEmUso.rowCount) {
        const dono = emailEmUso.rows[0];
        const detalhe = [dono.role, dono.company_name].filter(Boolean).join(' — ');
        return NextResponse.json(
          {
            error: `Este e-mail já está em uso por ${dono.name || 'outro cadastro'}`
              + (detalhe ? ` (${detalhe}).` : '.')
          },
          { status: 409 }
        );
      }
    }

    const incomingAvatar: string | null = typeof user.avatarUrl === 'string' ? user.avatarUrl : null;
    const isNewImage = !!incomingAvatar && incomingAvatar.startsWith('data:');
    const avatarThumbUrl = isNewImage ? await generateAvatarThumb(incomingAvatar) : null;

    // E-mail é opcional (migrations/profiles_email_opcional.sql). Campo
    // esvaziado na tela vira NULL, nunca string vazia: '' = '' é verdadeiro no
    // índice único, então dois cadastros sem e-mail colidiriam; com NULL, não.
    // `undefined` (chave ausente no corpo) continua significando "não mexer",
    // via o COALESCE abaixo.
    const emailParaGravar = user.email === undefined
      ? null
      : (typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null);
    const limpandoEmail = user.email !== undefined && !emailParaGravar;

    await query(
      `UPDATE public.profiles
       SET name = COALESCE($1, name),
           email = CASE WHEN $15::boolean THEN NULL ELSE COALESCE($2, email) END,
           role = $3,
           company_id = $4,
           -- COALESCE como em name/email: esta rota também é chamada com um
           -- objeto PARCIAL (settings/page.tsx manda só {id, avatarUrl} ao
           -- trocar a foto). Sem isto, trocar o avatar zerava o telefone do
           -- perfil. Para limpar o campo de propósito, mandar string vazia.
           phone = COALESCE($5, phone),
           must_change_password = COALESCE($6, must_change_password),
           view_all_company_tickets = COALESCE($7, view_all_company_tickets),
           is_admin = $8,
           avatar_url = CASE WHEN $14::boolean THEN $9 ELSE avatar_url END,
           internal_team_ids = $10,
           is_active = COALESCE($11, is_active),
           avatar_thumb_url = CASE WHEN $14::boolean THEN $13 ELSE avatar_thumb_url END
       WHERE id = $12`,
      [
        user.name,
        emailParaGravar,
        role,
        companyId || null,
        user.phone ?? null,
        user.mustChangePassword,
        user.viewAllCompanyTickets,
        isAdmin,
        isNewImage ? incomingAvatar : null,
        internalTeamIds || '{}',
        user.isActive,
        user.id,
        avatarThumbUrl,
        isNewImage,
        limpandoEmail
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in users PUT:', error);
    // 23505 = unique_violation. A checagem acima já cobre o caso do e-mail,
    // mas duas edições simultâneas ainda podem passar por ela — aqui é a rede
    // de segurança, para o usuário nunca ler o texto da constraint.
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'Já existe um cadastro com esse e-mail.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Não foi possível salvar o cadastro. Tente novamente.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID do usuário é obrigatório.' }, { status: 400 });
  }

  if (actor.id === id) {
    return NextResponse.json({ error: 'Você não pode excluir sua própria conta.' }, { status: 400 });
  }

  const check = await assertUserManageable(actor, id);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 403 });
  }

  try {
    await query('DELETE FROM public.profiles WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in users DELETE:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
