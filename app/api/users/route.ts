import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { getCurrentActionUser, assertUserManageable } from '@/app/actions';
import { generateAvatarThumb } from '@/lib/services/avatar-thumb-service';

// Papéis "de equipe" — os únicos que hoje consomem GET/POST desta rota
// (Canais de Atendimento, Filas, Hotfixes, vínculo de contato). Cliente/
// Funcionário nunca deveriam enxergar a lista completa de usuários do
// sistema nem criar contas por aqui.
const STAFF_ROLES = ['Administrador', 'Equipe', 'Time Interno'];

export async function GET(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor || !STAFF_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';

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
      const res = await query(
        "SELECT id, name, email, role, company_id, phone, avatar_url, internal_team_ids FROM public.profiles WHERE role IN ('Administrador', 'Equipe', 'Time Interno')"
      );
      return NextResponse.json(res.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        companyId: r.company_id,
        phone: r.phone,
        avatarUrl: r.avatar_url,
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
          `SELECT id, name, email, role, company_id, phone, avatar_url, internal_team_ids
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
            avatarUrl: r.avatar_url,
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
        `SELECT id, name, email, role, company_id, phone, avatar_url, internal_team_ids, COUNT(*) OVER() AS total_count
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
          avatarUrl: r.avatar_url,
          internalTeamIds: r.internal_team_ids
        })),
        total: res.rows.length > 0 ? parseInt(res.rows[0].total_count, 10) : 0
      });
    } else {
      const res = await query(
        "SELECT id, name, email, role, company_id, phone, view_all_company_tickets, must_change_password, is_admin, avatar_url, internal_team_ids, is_active FROM public.profiles"
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
        avatarUrl: r.avatar_url,
        internalTeamIds: r.internal_team_ids,
        isActive: r.is_active
      })));
    }
  } catch (error: any) {
    console.error('Error fetching users in API:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor || !STAFF_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { action } = body;

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

    // Miniatura gerada aqui (não no client) pra ficar consistente com o
    // sync do Bitrix24, que também escreve avatar_url direto no banco sem
    // passar por esta rota — ver lib/services/avatar-thumb-service.ts.
    const avatarThumbUrl = await generateAvatarThumb(user.avatarUrl || null);

    await query(
      `UPDATE public.profiles
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           role = $3,
           company_id = $4,
           phone = $5,
           must_change_password = COALESCE($6, must_change_password),
           view_all_company_tickets = COALESCE($7, view_all_company_tickets),
           is_admin = $8,
           avatar_url = $9,
           internal_team_ids = $10,
           is_active = COALESCE($11, is_active),
           avatar_thumb_url = $13
       WHERE id = $12`,
      [
        user.name,
        user.email,
        role,
        companyId || null,
        user.phone || null,
        user.mustChangePassword,
        user.viewAllCompanyTickets,
        isAdmin,
        user.avatarUrl || null,
        internalTeamIds || '{}',
        user.isActive,
        user.id,
        avatarThumbUrl
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in users PUT:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
