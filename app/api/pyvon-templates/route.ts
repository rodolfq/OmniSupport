import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentActionUser } from '@/lib/server-auth';
import { assertCanManageWhatsapp, permissionErrorStatus } from '@/lib/server-permissions';
import { logAudit } from '@/lib/audit-log';

/**
 * Templates de WhatsApp (HSM) aprovados na Meta, cadastrados à mão (o Pyvon
 * não expõe uma forma de listar templates aprovados por API — ver
 * lib/services/pyvon-service.ts). Leitura aberta a qualquer sessão da equipe
 * (o botão "Iniciar conversa por WhatsApp" no chamado/empresa precisa listar
 * os templates ativos); escrita exige whatsapp:manage.
 */

export async function GET() {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });

  try {
    const res = await query(
      `SELECT id, template_name, language, description, variables_schema, is_active, created_at
         FROM public.pyvon_templates ORDER BY created_at ASC`
    );
    return NextResponse.json(res.rows.map(r => ({
      id: r.id,
      templateName: r.template_name,
      language: r.language,
      description: r.description || '',
      variablesSchema: r.variables_schema || [],
      isActive: r.is_active
    })));
  } catch (err) {
    console.error('Error listing Pyvon templates:', err);
    return NextResponse.json({ error: 'Erro ao carregar templates.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const check = await assertCanManageWhatsapp();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
  const { actor } = check;

  try {
    const { id, templateName, language, description, variablesSchema, isActive } = await request.json();
    if (!templateName?.trim()) return NextResponse.json({ error: 'Nome do template é obrigatório.' }, { status: 400 });

    if (id) {
      await query(
        `UPDATE public.pyvon_templates
            SET template_name = $1, language = $2, description = $3, variables_schema = $4, is_active = $5
          WHERE id = $6`,
        [templateName.trim(), language || 'pt_BR', description || null, JSON.stringify(variablesSchema || []), isActive !== false, id]
      );
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'update',
        entityType: 'pyvon_template', entityId: id, entityLabel: templateName,
        changes: { templateName, language, isActive }
      });
      return NextResponse.json({ id });
    }

    const res = await query(
      `INSERT INTO public.pyvon_templates (template_name, language, description, variables_schema, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [templateName.trim(), language || 'pt_BR', description || null, JSON.stringify(variablesSchema || []), isActive !== false]
    );
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'create',
      entityType: 'pyvon_template', entityId: res.rows[0].id, entityLabel: templateName
    });
    return NextResponse.json({ id: res.rows[0].id });
  } catch (err) {
    console.error('Error saving Pyvon template:', err);
    return NextResponse.json({ error: 'Erro ao salvar template.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const check = await assertCanManageWhatsapp();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
  const { actor } = check;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

  try {
    const existing = await query('SELECT template_name FROM public.pyvon_templates WHERE id = $1', [id]);
    await query('DELETE FROM public.pyvon_templates WHERE id = $1', [id]);
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'delete',
      entityType: 'pyvon_template', entityId: id, entityLabel: existing.rows[0]?.template_name || null
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting Pyvon template:', err);
    return NextResponse.json({ error: 'Erro ao excluir template.' }, { status: 500 });
  }
}
