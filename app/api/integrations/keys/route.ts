import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { generateApiKey, INTEGRATION_SCOPES, type IntegrationScope } from '@/lib/integration-auth';

// Gestão de chaves da API de integração — autenticada por cookie de sessão
// (igual ao resto do portal), não pela API key. Só quem tem a permissão
// settings:system (mesma que já protege a aba "Geral do Sistema") pode
// criar/listar/revogar chaves. Ver lib/integration-auth.ts para a
// autenticação por API key usada pelas rotas /api/integrations/v1/*.

async function getActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;

  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;

  const result = await query(
    `SELECT p.id, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.role = p.role
     WHERE p.id = $1`,
    [decoded.id]
  );

  return result.rows[0] || null;
}

function canManageIntegrations(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('settings:system');
}

function serializeKey(row: any) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes || [],
    isActive: row.is_active,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });
  if (!canManageIntegrations(actor)) return NextResponse.json({ error: 'Sem permissão para gerenciar integrações.' }, { status: 403 });

  try {
    const res = await query(
      `SELECT id, name, key_prefix, scopes, is_active, last_used_at, created_at
       FROM public.integration_api_keys ORDER BY created_at DESC`
    );
    return NextResponse.json({ data: res.rows.map(serializeKey) });
  } catch (error: any) {
    console.error('[integrations/keys] Erro no GET:', error);
    return NextResponse.json({ error: 'Erro ao listar chaves.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });
  if (!canManageIntegrations(actor)) return NextResponse.json({ error: 'Sem permissão para gerenciar integrações.' }, { status: 403 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const { name, scopes } = body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });
  }
  const validScopes: IntegrationScope[] = Array.isArray(scopes)
    ? scopes.filter((s: string) => (INTEGRATION_SCOPES as readonly string[]).includes(s))
    : [];
  if (validScopes.length === 0) {
    return NextResponse.json({ error: 'Selecione ao menos um escopo válido.' }, { status: 400 });
  }

  const { rawKey, prefix, hash } = generateApiKey();

  try {
    const res = await query(
      `INSERT INTO public.integration_api_keys (name, key_prefix, key_hash, scopes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, key_prefix, scopes, is_active, last_used_at, created_at`,
      [name.trim(), prefix, hash, validScopes, actor.id]
    );
    // A chave em texto plano só existe nesta resposta — não é recuperável depois.
    return NextResponse.json({ data: { ...serializeKey(res.rows[0]), key: rawKey } }, { status: 201 });
  } catch (error: any) {
    console.error('[integrations/keys] Erro no POST:', error);
    return NextResponse.json({ error: 'Erro ao criar chave.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });
  if (!canManageIntegrations(actor)) return NextResponse.json({ error: 'Sem permissão para gerenciar integrações.' }, { status: 403 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const { id, isActive } = body;
  if (!id) {
    return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
  }

  try {
    const res = await query(
      `UPDATE public.integration_api_keys SET is_active = $1 WHERE id = $2
       RETURNING id, name, key_prefix, scopes, is_active, last_used_at, created_at`,
      [isActive !== false, id]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Chave não encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ data: serializeKey(res.rows[0]) });
  } catch (error: any) {
    console.error('[integrations/keys] Erro no PATCH:', error);
    return NextResponse.json({ error: 'Erro ao atualizar chave.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });
  if (!canManageIntegrations(actor)) return NextResponse.json({ error: 'Sem permissão para gerenciar integrações.' }, { status: 403 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
  }

  try {
    const res = await query('DELETE FROM public.integration_api_keys WHERE id = $1 RETURNING id', [id]);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Chave não encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[integrations/keys] Erro no DELETE:', error);
    return NextResponse.json({ error: 'Erro ao excluir chave.' }, { status: 500 });
  }
}
