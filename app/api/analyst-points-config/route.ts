import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { getPointsConfig, getPointsConfigHistory, savePointsConfig, validateWeightsInput } from '@/lib/services/analyst-points-service';

// Configuração da pontuação do ranking de analistas (Configurações > Pontuação do Ranking).
// Ler e alterar exigem a permissão reports:ranking_config (Administrador tem sempre).
// Mudar a pontuação altera o ranking de todo o time, por isso não basta estar logado.

const PERMISSION = 'reports:ranking_config';

async function getActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;
  const result = await query(
    `SELECT p.id, p.name, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [decoded.id]
  );
  return result.rows[0] || null;
}

function canConfigRanking(actor: any): boolean {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes(PERMISSION);
}

// Tags de conversa, com id e nome, para a seção de pesos por tag.
async function listChatTags(): Promise<{ id: string; label: string }[]> {
  const res = await query(
    `SELECT id::text AS id, label FROM public.config_tags WHERE domain = 'chat' ORDER BY label`
  );
  return res.rows;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!actor || !canConfigRanking(actor)) {
      return NextResponse.json({ error: 'Você não tem permissão para ver esta configuração.' }, { status: 403 });
    }
    const tags = await listChatTags();
    // ?history=1 devolve o histórico de alterações (quem mudou, quando, antes e depois).
    if (new URL(request.url).searchParams.get('history') === '1') {
      const entries = await getPointsConfigHistory(30);
      const labels = new Map(tags.map(t => [t.id, t.label]));
      return NextResponse.json({
        entries: entries.map(e => ({
          ...e,
          alteracoes: e.alteracoes.map(c => ({
            ...c,
            rotulo: c.campo.startsWith('tag:') ? `Tag: ${labels.get(c.campo.slice(4)) ?? 'tag removida'}` : c.campo,
          })),
        })),
      });
    }
    const config = await getPointsConfig();
    return NextResponse.json({
      weights: config.weights,
      updatedAt: config.updatedAt,
      isDefault: config.isDefault,
      tags,
    });
  } catch (error: any) {
    console.error('[analyst-points-config] Erro no GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!actor || !canConfigRanking(actor)) {
      return NextResponse.json({ error: 'Você não tem permissão para alterar a pontuação do ranking.' }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const parsed = validateWeightsInput(body?.weights);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const saved = await savePointsConfig(parsed.weights, { id: actor.id, name: actor.name ?? 'Usuário' });
    return NextResponse.json({
      weights: saved.weights,
      updatedAt: saved.updatedAt,
      isDefault: saved.isDefault,
    });
  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json(
        { error: 'A configuração ainda não está disponível neste banco (migração pendente).' },
        { status: 503 }
      );
    }
    console.error('[analyst-points-config] Erro no PUT:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
