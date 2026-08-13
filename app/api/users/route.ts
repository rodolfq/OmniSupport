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

    // A LISTAGEM devolve avatarUrl como o endereço de /api/users/<id>/avatar,
    // não mais o base64 (ver o comentário dessa rota). Telas que gravam
    // mandando o objeto de usuário inteiro de volta — link-contact-modal.tsx é
    // a que faz isso hoje — reenviariam essa URL no campo da foto, e gravá-la
    // apagaria a imagem, restando um endereço apontando pra si mesmo.
    //
    // Por isso avatar_url (e a miniatura) só são reescritos quando chega uma
    // IMAGEM de verdade, ou seja, uma `data:` URL. Qualquer outra coisa deixa
    // as duas colunas como estão.
    const incomingAvatar: string | null = typeof user.avatarUrl === 'string' ? user.avatarUrl : null;
    const isNewImage = !!incomingAvatar && incomingAvatar.startsWith('data:');
    const avatarThumbUrl = isNewImage ? await generateAvatarThumb(incomingAvatar) : null;

    await query(
      `UPDATE public.profiles
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
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
        user.email,
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
        isNewImage
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
