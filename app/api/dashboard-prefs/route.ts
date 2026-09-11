import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/jwt';
import { query } from '@/lib/db';

// Preferência pessoal do board de chamados do Dashboard (ordem/ocultar
// colunas, modo kanban/lista, ordenação da lista) — sempre escopada ao dono
// da sessão via JWT, sem checagem de Permission: cada um só lê/grava a própria.
export type DashboardListSort = 'urgency' | 'created_desc' | 'created_asc' | 'priority' | 'number' | 'title';
const LIST_SORT_VALUES: DashboardListSort[] = ['urgency', 'created_desc', 'created_asc', 'priority', 'number', 'title'];

export interface DashboardKanbanPrefs {
  order?: string[];
  hidden?: string[];
  view?: 'kanban' | 'list';
  sortBy?: DashboardListSort;
}

async function getActorId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  return decoded?.id || null;
}

export async function GET(request: NextRequest) {
  const actorId = await getActorId(request);
  if (!actorId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const res = await query('SELECT dashboard_kanban_prefs FROM public.profiles WHERE id = $1', [actorId]);
    return NextResponse.json({ prefs: res.rows[0]?.dashboard_kanban_prefs || null });
  } catch (error: any) {
    console.error('Erro ao buscar dashboard-prefs:', error);
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const actorId = await getActorId(request);
  if (!actorId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const body = await request.json();
    const prefs: DashboardKanbanPrefs = {
      order: Array.isArray(body.order) ? body.order : undefined,
      hidden: Array.isArray(body.hidden) ? body.hidden : undefined,
      view: body.view === 'list' ? 'list' : body.view === 'kanban' ? 'kanban' : undefined,
      sortBy: LIST_SORT_VALUES.includes(body.sortBy) ? body.sortBy : undefined
    };

    await query('UPDATE public.profiles SET dashboard_kanban_prefs = $1 WHERE id = $2', [JSON.stringify(prefs), actorId]);
    return NextResponse.json({ success: true, prefs });
  } catch (error: any) {
    console.error('Erro ao salvar dashboard-prefs:', error);
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}
