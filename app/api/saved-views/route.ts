import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';

// Buscas salvas do usuário (barra de filtros da lista de chamados).
//
// Criada para tirar components/filter-bar.tsx do shim de compatibilidade.
// O dono da busca vem SEMPRE da sessão, nunca do corpo da requisição: pelo
// shim, o client mandava `user_id` junto, então bastava trocar esse campo
// para gravar (ou listar) busca salva na conta de outra pessoa.

async function getSessionUserId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  return decoded?.id || null;
}

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const res = await query(
      'SELECT id, name, filters FROM public.saved_views WHERE user_id = $1 ORDER BY name ASC',
      [userId]
    );
    return NextResponse.json(res.rows);
  } catch (error: any) {
    console.error('[saved-views GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const { name, filters } = await request.json();
    const label = (name || '').trim();
    if (!label) return NextResponse.json({ error: 'O nome da busca é obrigatório.' }, { status: 400 });

    const res = await query(
      `INSERT INTO public.saved_views (user_id, name, filters)
       VALUES ($1, $2, $3) RETURNING id, name, filters`,
      [userId, label, JSON.stringify(filters || {})]
    );
    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    console.error('[saved-views POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

  try {
    // O user_id no WHERE é a trava: ninguém apaga busca salva de outra pessoa
    // mesmo conhecendo o id.
    await query('DELETE FROM public.saved_views WHERE id = $1 AND user_id = $2', [id, userId]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[saved-views DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
