import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import { getCurrentActionUser } from '@/lib/server-auth';
import { assertCanManageWhatsapp, permissionErrorStatus } from '@/lib/server-permissions';

/**
 * Canais de WhatsApp (whatsapp_instances). Substitui getWhatsappInstances /
 * saveWhatsappInstance / deleteWhatsappInstance.
 *
 * SEGREDO: `access_token` NUNCA sai do servidor — a listagem devolve apenas o
 * booleano `hasAccessToken`. É por isso que a leitura pode ser aberta a
 * qualquer sessão (a tela de Filas e os filtros de relatório listam canais sem
 * ter whatsapp:manage), enquanto gravar e excluir exigem a permissão.
 */

export async function GET() {
  try {
    const actor = await getCurrentActionUser();
    if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

    const res = await query(
      `SELECT id, name, phone, status, provider, phone_number_id, verify_token,
              (access_token IS NOT NULL AND access_token <> '') AS has_access_token
         FROM public.whatsapp_instances ORDER BY created_at ASC`
    );
    return NextResponse.json(res.rows.map(r => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      status: r.status,
      provider: r.provider || 'baileys',
      phoneNumberId: r.phone_number_id || undefined,
      hasAccessToken: r.has_access_token,
      verifyToken: r.verify_token || undefined
    })));
  } catch (err) {
    console.error('Error getting WhatsApp instances:', err);
    return NextResponse.json({ error: 'Erro ao carregar canais de WhatsApp.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const check = await assertCanManageWhatsapp();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
    const { actor } = check;

    const { id, name, phone, status, provider = 'baileys', meta } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: 'Informe um nome para o canal.' }, { status: 400 });

    if (id) {
      // access_token: string vazia significa "não mexer". O campo fica em
      // branco na edição para não reexibir o segredo já salvo, então gravar o
      // vazio apagaria o token de quem só quis renomear o canal.
      await query(
        `UPDATE public.whatsapp_instances
            SET name = $1, phone = $2, status = $3, provider = $4,
                phone_number_id = $5,
                verify_token = COALESCE($6, verify_token),
                access_token = CASE WHEN $7 = '' THEN access_token ELSE $7 END,
                updated_at = NOW()
          WHERE id = $8`,
        [name.trim(), phone || null, status, provider, meta?.phoneNumberId || null, meta?.verifyToken || null, meta?.accessToken ?? '', id]
      );
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'update',
        entityType: 'whatsapp_instance', entityId: id, entityLabel: name,
        changes: { name, provider, phoneNumberId: meta?.phoneNumberId }
      });
      return NextResponse.json({ id });
    }

    const newId = crypto.randomUUID();
    // Canal Meta precisa de verify_token para configurar o webhook no painel
    // da Meta — gera um se quem criou não informou.
    const verifyToken = provider === 'meta'
      ? (meta?.verifyToken || crypto.randomUUID().replace(/-/g, ''))
      : null;
    await query(
      `INSERT INTO public.whatsapp_instances (id, name, phone, status, provider, phone_number_id, access_token, verify_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId, name.trim(), phone || null, status, provider, meta?.phoneNumberId || null, meta?.accessToken || null, verifyToken]
    );
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'create',
      entityType: 'whatsapp_instance', entityId: newId, entityLabel: name,
      changes: { name, provider, phoneNumberId: meta?.phoneNumberId }
    });
    return NextResponse.json({ id: newId });
  } catch (err) {
    console.error('Error saving WhatsApp instance:', err);
    return NextResponse.json({ error: 'Erro ao salvar canal de WhatsApp.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const check = await assertCanManageWhatsapp();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
    const { actor } = check;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

    if (id === 'default') {
      return NextResponse.json(
        { error: 'O canal padrão do WhatsApp (QR Code) não pode ser excluído.' },
        { status: 400 }
      );
    }

    // Fila apontando para o canal ficaria sem instância e as mensagens dela
    // sairiam pela instância errada — melhor recusar e explicar.
    const inUse = await query('SELECT name FROM public.queues WHERE whatsapp_instance_id = $1', [id]);
    if ((inUse.rowCount ?? 0) > 0) {
      const names = inUse.rows.map((r: any) => r.name).join(', ');
      return NextResponse.json(
        { error: `Não é possível excluir: canal em uso pela(s) fila(s) ${names}. Desvincule antes de excluir.` },
        { status: 409 }
      );
    }

    const existing = await query('SELECT name FROM public.whatsapp_instances WHERE id = $1', [id]);
    await query('DELETE FROM public.whatsapp_instances WHERE id = $1', [id]);
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'delete',
      entityType: 'whatsapp_instance', entityId: id, entityLabel: existing.rows[0]?.name || null
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting WhatsApp instance:', err);
    return NextResponse.json({ error: 'Erro ao excluir canal de WhatsApp.' }, { status: 500 });
  }
}
