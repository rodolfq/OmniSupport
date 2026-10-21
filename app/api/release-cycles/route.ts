import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import { assertCanManageHotfixes, assertCanViewHotfixes, permissionErrorStatus } from '@/lib/server-permissions';
import { generateStagesFromTemplate, isLastStage, computeOffsetsFromAnchor } from '@/lib/release-stage-logic';
import type { ReleaseCycle, ReleaseCycleStage, ReleaseItem, ReleaseTemplate, ReleaseTemplateStage } from '@/lib/types';

/**
 * Ciclo de publicação (2026-10-19, reestruturado no mesmo dia). Um CICLO é
 * um intervalo de tempo com UMA timeline compartilhada; Hotfix e Publicação
 * (Emergencial/Prevista) são ITENS independentes — vários de cada — dentro
 * do mesmo ciclo. Reusa as permissões hotfixes:view/hotfixes:manage (ver
 * CLAUDE.md seção 15) — não tem relação com /api/hotfixes (fluxo achatado
 * legado, tabela `hotfixes`, intocado por esta rota).
 *
 * ATENÇÃO ao mexer nas datas: node-pg devolve DATE/TIMESTAMP como objeto
 * Date — normalizado pra string abaixo, senão o formato depende de como a
 * serialização trata Date e a tela quebra ao formatar o que achava ser texto.
 */

function toIsoDateOnly(value: any): string {
  if (!value) return '';
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}
function toIsoOrUndefined(value: any): string | undefined {
  if (!value) return undefined;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
function toIsoOrNull(value: any): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapStage(row: any): ReleaseCycleStage {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    templateStageId: row.template_stage_id,
    stageOrder: row.stage_order,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    startDate: toIsoDateOnly(row.start_date),
    endDate: toIsoDateOnly(row.end_date),
    plannedStartDate: toIsoDateOnly(row.planned_start_date),
    plannedEndDate: toIsoDateOnly(row.planned_end_date),
    teamId: row.team_id,
    responsibleIds: row.responsible_ids || [],
    notes: row.notes,
    completedAt: toIsoOrNull(row.completed_at),
  };
}

function mapItem(row: any): ReleaseItem {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    itemType: row.item_type,
    name: row.name,
    description: row.description,
    responsibleId: row.responsible_id,
    currentStageId: row.current_stage_id,
    completedAt: toIsoOrNull(row.completed_at),
    internalTicketCount: Number(row.internal_ticket_count || 0),
    clientTicketCount: Number(row.client_ticket_count || 0),
    // `ri.*` tolera a coluna ainda não existir (migrations/hotfix_cycle_link.sql,
    // pendente — moratória de banco): vem undefined → null, nunca quebra.
    sourceHotfixId: row.source_hotfix_id || null,
    createdAt: toIsoOrUndefined(row.created_at) || '',
  };
}

/**
 * Cria o release_item "espelho" de um hotfix solto (fluxo achatado legado)
 * dentro de um ciclo, e marca o hotfix de origem como vinculado — usado
 * tanto por `create-cycle` (vincular hotfixes soltos ao criar o ciclo novo)
 * quanto por `link-hotfix` (vincular a um ciclo já existente). Snapshot: não
 * fica sincronizado com o hotfix depois (editar o hotfix não atualiza o
 * item, e vice-versa) — decisão deliberada pra não precisar de
 * trigger/sincronização contínua entre os dois modelos.
 *
 * Pré-condições (responsabilidade do chamador verificar o ciclo
 * destravado): hotfix existe, não publicado/travado, ainda não vinculado.
 */
async function createItemFromHotfix(
  hotfixId: string, cycleId: string, itemType: string, currentStageId: string | null | undefined,
  actor: { id: string; name: string }
): Promise<{ itemId: string } | { error: string }> {
  if (!['hotfix', 'emergencial', 'prevista'].includes(itemType)) {
    return { error: 'Tipo de publicação inválido.' };
  }
  const hotfixRes = await query('SELECT * FROM public.hotfixes WHERE id = $1', [hotfixId]);
  if (hotfixRes.rowCount === 0) return { error: 'Hotfix não encontrado.' };
  const hotfix = hotfixRes.rows[0];
  if (hotfix.published_at) return { error: `Hotfix "${hotfix.name}" já publicado — travado, não pode ser vinculado.` };
  if (hotfix.release_cycle_id) return { error: `Hotfix "${hotfix.name}" já está vinculado a outro ciclo.` };

  const itemId = crypto.randomUUID();
  await query(
    `INSERT INTO public.release_items (id, cycle_id, item_type, name, description, responsible_id, current_stage_id, source_hotfix_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [itemId, cycleId, itemType, hotfix.name, hotfix.description, hotfix.responsible_id, currentStageId || null, hotfixId, actor.id]
  );
  await query('UPDATE public.hotfixes SET release_cycle_id = $1, release_item_id = $2, updated_at = now() WHERE id = $3', [cycleId, itemId, hotfixId]);
  logAudit({
    actorId: actor.id, actorName: actor.name, action: 'create', entityType: 'release_item', entityId: itemId, entityLabel: hotfix.name,
    changes: { cycleId, itemType, sourceHotfixId: hotfixId }
  });
  return { itemId };
}

function mapCycle(row: any, stages: ReleaseCycleStage[], items: ReleaseItem[]): ReleaseCycle {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    templateId: row.template_id,
    anchorDate: row.anchor_date ? toIsoDateOnly(row.anchor_date) : null,
    responsibleId: row.responsible_id,
    publishedAt: toIsoOrNull(row.published_at),
    createdAt: toIsoOrUndefined(row.created_at) || '',
    stages,
    items,
  };
}

function mapTemplateStage(row: any): ReleaseTemplateStage {
  return {
    id: row.id,
    templateId: row.template_id,
    stageOrder: row.stage_order,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    offsetStartDays: row.offset_start_days,
    offsetEndDays: row.offset_end_days,
    defaultTeamId: row.default_team_id,
    defaultResponsibleIds: row.default_responsible_ids || [],
  };
}

async function fetchStagesAndItemsByCycleIds(cycleIds: string[]): Promise<{ stages: Map<string, ReleaseCycleStage[]>; items: Map<string, ReleaseItem[]> }> {
  const stagesMap = new Map<string, ReleaseCycleStage[]>();
  const itemsMap = new Map<string, ReleaseItem[]>();
  if (cycleIds.length === 0) return { stages: stagesMap, items: itemsMap };

  const stagesRes = await query(
    `SELECT * FROM public.release_cycle_stages WHERE cycle_id = ANY($1::uuid[]) ORDER BY cycle_id, stage_order ASC`,
    [cycleIds]
  );
  for (const row of stagesRes.rows) {
    const stage = mapStage(row);
    const list = stagesMap.get(stage.cycleId) || [];
    list.push(stage);
    stagesMap.set(stage.cycleId, list);
  }

  const itemsRes = await query(
    `SELECT ri.*,
            (SELECT COUNT(*) FROM public.internal_tickets it WHERE it.release_item_id = ri.id) AS internal_ticket_count,
            (SELECT COUNT(*) FROM public.release_item_tickets rit WHERE rit.release_item_id = ri.id) AS client_ticket_count
       FROM public.release_items ri
      WHERE ri.cycle_id = ANY($1::uuid[])
      ORDER BY ri.created_at ASC`,
    [cycleIds]
  );
  for (const row of itemsRes.rows) {
    const item = mapItem(row);
    const list = itemsMap.get(item.cycleId) || [];
    list.push(item);
    itemsMap.set(item.cycleId, list);
  }

  return { stages: stagesMap, items: itemsMap };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'templates') {
      const check = await assertCanViewHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

      const templatesRes = await query('SELECT * FROM public.release_templates ORDER BY name');
      const templateIds = templatesRes.rows.map(r => r.id);
      const stagesByTemplate = new Map<string, ReleaseTemplateStage[]>();
      if (templateIds.length > 0) {
        const stagesRes = await query(
          `SELECT * FROM public.release_template_stages WHERE template_id = ANY($1::uuid[]) ORDER BY template_id, stage_order ASC`,
          [templateIds]
        );
        for (const row of stagesRes.rows) {
          const stage = mapTemplateStage(row);
          const list = stagesByTemplate.get(stage.templateId) || [];
          list.push(stage);
          stagesByTemplate.set(stage.templateId, list);
        }
      }
      const templates: ReleaseTemplate[] = templatesRes.rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: r.is_active,
        createdAt: toIsoOrUndefined(r.created_at) || '',
        stages: stagesByTemplate.get(r.id) || [],
      }));
      return NextResponse.json(templates);
    }

    if (action === 'item-tickets') {
      const check = await assertCanViewHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const itemId = searchParams.get('itemId');
      if (!itemId) return NextResponse.json({ error: 'itemId é obrigatório.' }, { status: 400 });

      const [internalRes, clientRes] = await Promise.all([
        query(
          `SELECT id, title, internal_ticket_number FROM public.internal_tickets WHERE release_item_id = $1 ORDER BY internal_ticket_number DESC`,
          [itemId]
        ),
        query(
          `SELECT t.id, t.public_ticket_number, t.title
             FROM public.release_item_tickets rit
             JOIN public.tickets t ON t.id = rit.ticket_id
            WHERE rit.release_item_id = $1
            ORDER BY t.public_ticket_number DESC`,
          [itemId]
        )
      ]);

      return NextResponse.json({
        internalTickets: internalRes.rows.map((r: any) => ({ id: r.id, title: r.title, internalTicketNumber: r.internal_ticket_number })),
        clientTickets: clientRes.rows.map((r: any) => ({ id: r.id, title: r.title || '', publicTicketNumber: r.public_ticket_number })),
      });
    }

    if (action === 'stage-audit') {
      const check = await assertCanViewHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const stageId = searchParams.get('stageId');
      if (!stageId) return NextResponse.json({ error: 'stageId é obrigatório.' }, { status: 400 });
      const res = await query(
        `SELECT actor_name, action, changes, created_at FROM public.audit_log
          WHERE entity_type = 'release_cycle_stage' AND entity_id = $1
          ORDER BY created_at DESC LIMIT 50`,
        [stageId]
      );
      return NextResponse.json(res.rows.map(r => ({
        actorName: r.actor_name,
        action: r.action,
        changes: r.changes,
        createdAt: toIsoOrUndefined(r.created_at),
      })));
    }

    // Listagem padrão: todos os ciclos, com etapas e itens embutidos.
    const checkView = await assertCanViewHotfixes();
    if (!checkView.ok) return NextResponse.json({ error: checkView.error }, { status: permissionErrorStatus(checkView.error) });

    const res = await query('SELECT * FROM public.release_cycles ORDER BY created_at DESC');
    const { stages, items } = await fetchStagesAndItemsByCycleIds(res.rows.map(r => r.id));
    return NextResponse.json(res.rows.map(c => mapCycle(c, stages.get(c.id) || [], items.get(c.id) || [])));
  } catch (err) {
    console.error('Error getting release cycles:', err);
    return NextResponse.json({ error: 'Erro ao carregar ciclos de publicação.' }, { status: 500 });
  }
}

/** Ciclo travado = release_cycles.published_at já setado. */
async function assertCycleNotLocked(cycleId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await query('SELECT published_at FROM public.release_cycles WHERE id = $1', [cycleId]);
  if (existing.rowCount === 0) return { ok: false, error: 'Ciclo não encontrado.' };
  if (existing.rows[0].published_at) {
    return { ok: false, error: 'Este ciclo já foi concluído — fica travado e não pode ser alterado.' };
  }
  return { ok: true };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action;

    // ---- Modelos ----

    if (action === 'save-template') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;

      const { id, name, description, isActive = true, stages } = body;
      if (!name?.trim()) return NextResponse.json({ error: 'O nome do modelo é obrigatório.' }, { status: 400 });
      if (!Array.isArray(stages) || stages.length === 0) {
        return NextResponse.json({ error: 'O modelo precisa de ao menos uma etapa.' }, { status: 400 });
      }

      const templateId = id || crypto.randomUUID();
      if (id) {
        await query(`UPDATE public.release_templates SET name=$1, description=$2, is_active=$3, updated_at=now() WHERE id=$4`, [name, description || null, isActive, id]);
        // Troca as etapas do modelo inteiras — mais simples que diff, e não
        // destrutivo: release_cycle_stages.template_stage_id é ON DELETE
        // SET NULL, nunca apaga etapa já gerada de um ciclo concreto.
        await query('DELETE FROM public.release_template_stages WHERE template_id = $1', [id]);
      } else {
        await query(`INSERT INTO public.release_templates (id, name, description, is_active, created_by) VALUES ($1,$2,$3,$4,$5)`, [templateId, name, description || null, isActive, actor.id]);
      }

      let order = 0;
      for (const s of stages) {
        if (!s.name?.trim()) continue;
        await query(
          `INSERT INTO public.release_template_stages
             (template_id, stage_order, name, description, color, icon, offset_start_days, offset_end_days, default_team_id, default_responsible_ids)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            templateId, order++, s.name, s.description || null, s.color || '#2563eb', s.icon || null,
            Number(s.offsetStartDays) || 0, Number(s.offsetEndDays ?? s.offsetStartDays) || 0,
            s.defaultTeamId || null, s.defaultResponsibleIds || []
          ]
        );
      }

      logAudit({ actorId: actor.id, actorName: actor.name, action: id ? 'update' : 'create', entityType: 'release_template', entityId: templateId, entityLabel: name });
      return NextResponse.json({ id: templateId });
    }

    if (action === 'delete-template') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
      const existing = await query('SELECT name FROM public.release_templates WHERE id = $1', [id]);
      await query('DELETE FROM public.release_templates WHERE id = $1', [id]);
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'delete', entityType: 'release_template', entityId: id, entityLabel: existing.rows[0]?.name || null });
      return NextResponse.json({ success: true });
    }

    if (action === 'save-as-template') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { cycleId, name } = body;
      if (!cycleId || !name?.trim()) return NextResponse.json({ error: 'cycleId e name são obrigatórios.' }, { status: 400 });

      const cycleRes = await query('SELECT anchor_date FROM public.release_cycles WHERE id = $1', [cycleId]);
      if (cycleRes.rowCount === 0) return NextResponse.json({ error: 'Ciclo não encontrado.' }, { status: 404 });
      const anchorDate = cycleRes.rows[0].anchor_date ? toIsoDateOnly(cycleRes.rows[0].anchor_date) : null;
      if (!anchorDate) return NextResponse.json({ error: 'Este ciclo não tem data-âncora — não é possível derivar um modelo dele.' }, { status: 400 });

      const stagesRes = await query('SELECT * FROM public.release_cycle_stages WHERE cycle_id = $1 ORDER BY stage_order ASC', [cycleId]);
      if (stagesRes.rowCount === 0) return NextResponse.json({ error: 'Este ciclo não tem etapas.' }, { status: 400 });

      const templateId = crypto.randomUUID();
      await query(`INSERT INTO public.release_templates (id, name, description, is_active, created_by) VALUES ($1,$2,$3,true,$4)`, [templateId, name, `Gerado a partir do ciclo "${name}".`, actor.id]);
      let order = 0;
      for (const row of stagesRes.rows) {
        const stage = mapStage(row);
        const { offsetStartDays, offsetEndDays } = computeOffsetsFromAnchor(stage, anchorDate);
        await query(
          `INSERT INTO public.release_template_stages
             (template_id, stage_order, name, description, color, icon, offset_start_days, offset_end_days, default_team_id, default_responsible_ids)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [templateId, order++, stage.name, stage.description, stage.color, stage.icon, offsetStartDays, offsetEndDays, stage.teamId, stage.responsibleIds]
        );
      }
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'create', entityType: 'release_template', entityId: templateId, entityLabel: name, changes: { origin: 'save-as-template', cycleId } });
      return NextResponse.json({ id: templateId });
    }

    // ---- Ciclo e etapa ----

    if (action === 'create-cycle') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;

      const { name, description, responsibleId, templateId, anchorDate, stageColorOverrides, linkHotfixIds } = body;
      if (!name?.trim()) return NextResponse.json({ error: 'O nome é obrigatório.' }, { status: 400 });

      let templateStages: ReleaseTemplateStage[] = [];
      if (templateId) {
        if (!anchorDate) return NextResponse.json({ error: 'Informe a data-âncora para usar um modelo.' }, { status: 400 });
        const stagesRes = await query('SELECT * FROM public.release_template_stages WHERE template_id = $1 ORDER BY stage_order ASC', [templateId]);
        templateStages = stagesRes.rows.map(mapTemplateStage);
        if (templateStages.length === 0) return NextResponse.json({ error: 'O modelo escolhido não tem etapas.' }, { status: 400 });
      }

      // stageColorOverrides (opcional, por templateStageId): personaliza a
      // cor de cada etapa gerada SÓ neste ciclo, sem alterar o modelo
      // compartilhado — pedido do usuário, 2026-10-21.
      const drafts = templateId ? generateStagesFromTemplate(templateStages, anchorDate, stageColorOverrides || undefined) : [];

      const newId = crypto.randomUUID();
      await query(
        `INSERT INTO public.release_cycles (id, name, description, responsible_id, created_by, template_id, anchor_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newId, name, description || null, responsibleId || null, actor.id, templateId || null, anchorDate || null]
      );

      for (const d of drafts) {
        const stageId = crypto.randomUUID();
        await query(
          `INSERT INTO public.release_cycle_stages
             (id, cycle_id, template_stage_id, stage_order, name, description, color, icon, start_date, end_date, planned_start_date, planned_end_date, team_id, responsible_ids)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$10,$11,$12)`,
          [stageId, newId, d.templateStageId, d.stageOrder, d.name, d.description, d.color, d.icon, d.startDate, d.endDate, d.teamId, d.responsibleIds]
        );
      }

      // Vincular hotfix(es) soltos ao ciclo recém-criado (pedido do usuário,
      // 2026-10-21) — mesma criação de release_item espelho de `link-hotfix`,
      // só que em lote. Um hotfix que falhar (já vinculado/publicado nesse
      // meio-tempo) não derruba a criação do ciclo nem os demais vínculos —
      // reportado em `linkErrors` pro client avisar.
      const linkErrors: string[] = [];
      if (Array.isArray(linkHotfixIds)) {
        for (const entry of linkHotfixIds) {
          const result = await createItemFromHotfix(entry.hotfixId, newId, entry.itemType || 'hotfix', entry.currentStageId, actor);
          if ('error' in result) linkErrors.push(result.error);
        }
      }

      logAudit({ actorId: actor.id, actorName: actor.name, action: 'create', entityType: 'release_cycle', entityId: newId, entityLabel: name, changes: { templateId, anchorDate, stageCount: drafts.length, linkedHotfixCount: (linkHotfixIds?.length || 0) - linkErrors.length } });

      const { stages, items } = await fetchStagesAndItemsByCycleIds([newId]);
      const cycleRow = (await query('SELECT * FROM public.release_cycles WHERE id = $1', [newId])).rows[0];
      return NextResponse.json({ id: newId, cycle: mapCycle(cycleRow, stages.get(newId) || [], items.get(newId) || []), linkErrors: linkErrors.length ? linkErrors : undefined });
    }

    if (action === 'link-hotfix') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { hotfixId, cycleId, itemType, currentStageId } = body;
      if (!hotfixId || !cycleId) return NextResponse.json({ error: 'hotfixId e cycleId são obrigatórios.' }, { status: 400 });

      const lock = await assertCycleNotLocked(cycleId);
      if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 409 });

      const result = await createItemFromHotfix(hotfixId, cycleId, itemType || 'hotfix', currentStageId, actor);
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 });
      return NextResponse.json({ itemId: result.itemId });
    }

    if (action === 'add-stage') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { cycleId, name, description, color, startDate, endDate } = body;
      if (!cycleId || !name?.trim() || !startDate || !endDate) {
        return NextResponse.json({ error: 'cycleId, name, startDate e endDate são obrigatórios.' }, { status: 400 });
      }
      if (endDate < startDate) return NextResponse.json({ error: 'A data final não pode ser antes da inicial.' }, { status: 400 });

      const lock = await assertCycleNotLocked(cycleId);
      if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 409 });

      const orderRes = await query('SELECT COALESCE(MAX(stage_order), -1) + 1 AS next_order FROM public.release_cycle_stages WHERE cycle_id = $1', [cycleId]);
      const nextOrder = orderRes.rows[0].next_order;
      const stageId = crypto.randomUUID();
      await query(
        `INSERT INTO public.release_cycle_stages (id, cycle_id, stage_order, name, description, color, start_date, end_date, planned_start_date, planned_end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7,$8)`,
        [stageId, cycleId, nextOrder, name, description || null, color || '#2563eb', startDate, endDate]
      );
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'create', entityType: 'release_cycle_stage', entityId: stageId, entityLabel: name, changes: { cycleId, manual: true } });
      return NextResponse.json({ id: stageId });
    }

    if (action === 'update-stage') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { stageId, name, description, color, startDate, endDate, teamId, responsibleIds, notes } = body;
      if (!stageId) return NextResponse.json({ error: 'stageId é obrigatório.' }, { status: 400 });

      const existingRes = await query('SELECT * FROM public.release_cycle_stages WHERE id = $1', [stageId]);
      if (existingRes.rowCount === 0) return NextResponse.json({ error: 'Etapa não encontrada.' }, { status: 404 });
      const existing = existingRes.rows[0];

      const lock = await assertCycleNotLocked(existing.cycle_id);
      if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 409 });

      const nextStart = startDate ?? toIsoDateOnly(existing.start_date);
      const nextEnd = endDate ?? toIsoDateOnly(existing.end_date);
      if (nextEnd < nextStart) return NextResponse.json({ error: 'A data final não pode ser antes da inicial.' }, { status: 400 });

      await query(
        `UPDATE public.release_cycle_stages
            SET name = COALESCE($1, name),
                description = COALESCE($2, description),
                color = COALESCE($3, color),
                start_date = $4,
                end_date = $5,
                team_id = $6,
                responsible_ids = COALESCE($7, responsible_ids),
                notes = COALESCE($8, notes),
                updated_at = now()
          WHERE id = $9`,
        [name, description, color, nextStart, nextEnd, teamId === undefined ? existing.team_id : teamId, responsibleIds, notes, stageId]
      );

      const prevStart = toIsoDateOnly(existing.start_date);
      const prevEnd = toIsoDateOnly(existing.end_date);
      if (prevStart !== nextStart || prevEnd !== nextEnd) {
        logAudit({
          actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'release_cycle_stage', entityId: stageId, entityLabel: existing.name,
          changes: { field: 'dates', from: { startDate: prevStart, endDate: prevEnd }, to: { startDate: nextStart, endDate: nextEnd } }
        });
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'delete-stage') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { stageId } = body;
      if (!stageId) return NextResponse.json({ error: 'stageId é obrigatório.' }, { status: 400 });
      const existing = await query('SELECT cycle_id, name FROM public.release_cycle_stages WHERE id = $1', [stageId]);
      if (existing.rowCount === 0) return NextResponse.json({ error: 'Etapa não encontrada.' }, { status: 404 });
      const lock = await assertCycleNotLocked(existing.rows[0].cycle_id);
      if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 409 });
      await query('DELETE FROM public.release_cycle_stages WHERE id = $1', [stageId]);
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'delete', entityType: 'release_cycle_stage', entityId: stageId, entityLabel: existing.rows[0].name });
      return NextResponse.json({ success: true });
    }

    if (action === 'complete-stage' || action === 'reopen-stage') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { stageId } = body;
      if (!stageId) return NextResponse.json({ error: 'stageId é obrigatório.' }, { status: 400 });

      const existing = await query('SELECT * FROM public.release_cycle_stages WHERE id = $1', [stageId]);
      if (existing.rowCount === 0) return NextResponse.json({ error: 'Etapa não encontrada.' }, { status: 404 });
      const stage = existing.rows[0];
      const lock = await assertCycleNotLocked(stage.cycle_id);
      if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 409 });

      if (action === 'reopen-stage') {
        await query('UPDATE public.release_cycle_stages SET completed_at = NULL, updated_at = now() WHERE id = $1', [stageId]);
        logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'release_cycle_stage', entityId: stageId, entityLabel: stage.name, changes: { field: 'completedAt', to: null } });
        return NextResponse.json({ success: true, locked: false });
      }

      await query('UPDATE public.release_cycle_stages SET completed_at = now(), updated_at = now() WHERE id = $1', [stageId]);
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'release_cycle_stage', entityId: stageId, entityLabel: stage.name, changes: { field: 'completedAt', to: 'now' } });

      const allStages = await query('SELECT stage_order FROM public.release_cycle_stages WHERE cycle_id = $1', [stage.cycle_id]);
      let locked = false;
      if (isLastStage({ stageOrder: stage.stage_order }, allStages.rows.map(r => ({ stageOrder: r.stage_order })))) {
        await query('UPDATE public.release_cycles SET published_at = now(), updated_at = now() WHERE id = $1 AND published_at IS NULL', [stage.cycle_id]);
        logAudit({ actorId: actor.id, actorName: actor.name, action: 'publish', entityType: 'release_cycle', entityId: stage.cycle_id, entityLabel: null, changes: { trigger: 'last_stage_completed' } });
        locked = true;
      }
      return NextResponse.json({ success: true, locked });
    }

    // ---- Item (Hotfix / Publicação) ----

    if (action === 'create-item') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { cycleId, itemType, name, description, responsibleId, currentStageId } = body;
      if (!cycleId || !name?.trim() || !['hotfix', 'emergencial', 'prevista'].includes(itemType)) {
        return NextResponse.json({ error: 'cycleId, name e itemType são obrigatórios.' }, { status: 400 });
      }
      const lock = await assertCycleNotLocked(cycleId);
      if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 409 });

      const itemId = crypto.randomUUID();
      await query(
        `INSERT INTO public.release_items (id, cycle_id, item_type, name, description, responsible_id, current_stage_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [itemId, cycleId, itemType, name, description || null, responsibleId || null, currentStageId || null, actor.id]
      );
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'create', entityType: 'release_item', entityId: itemId, entityLabel: name, changes: { cycleId, itemType } });
      return NextResponse.json({ id: itemId });
    }

    if (action === 'update-item') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { itemId, name, description, responsibleId, currentStageId } = body;
      if (!itemId) return NextResponse.json({ error: 'itemId é obrigatório.' }, { status: 400 });

      const existing = await query('SELECT * FROM public.release_items WHERE id = $1', [itemId]);
      if (existing.rowCount === 0) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
      const existingRow = existing.rows[0];
      const lock = await assertCycleNotLocked(existingRow.cycle_id);
      if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 409 });

      // responsibleId/currentStageId são tri-estado (omitido = não mexe;
      // null = limpar; string = trocar) — nunca passa `undefined` pro
      // driver do pg, que não aceita.
      const nextResponsibleId = responsibleId === undefined ? existingRow.responsible_id : responsibleId;
      const nextCurrentStageId = currentStageId === undefined ? existingRow.current_stage_id : currentStageId;

      await query(
        `UPDATE public.release_items
            SET name = COALESCE($1, name),
                description = COALESCE($2, description),
                responsible_id = $3,
                current_stage_id = $4,
                updated_at = now()
          WHERE id = $5`,
        [name, description, nextResponsibleId, nextCurrentStageId, itemId]
      );
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'release_item', entityId: itemId, entityLabel: name || existingRow.name });
      return NextResponse.json({ success: true });
    }

    if (action === 'delete-item') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { itemId } = body;
      if (!itemId) return NextResponse.json({ error: 'itemId é obrigatório.' }, { status: 400 });
      const existing = await query('SELECT cycle_id, name FROM public.release_items WHERE id = $1', [itemId]);
      if (existing.rowCount === 0) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
      const lock = await assertCycleNotLocked(existing.rows[0].cycle_id);
      if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 409 });
      await query('DELETE FROM public.release_items WHERE id = $1', [itemId]);
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'delete', entityType: 'release_item', entityId: itemId, entityLabel: existing.rows[0].name });
      return NextResponse.json({ success: true });
    }

    if (action === 'complete-item' || action === 'reopen-item') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { itemId } = body;
      if (!itemId) return NextResponse.json({ error: 'itemId é obrigatório.' }, { status: 400 });
      const existing = await query('SELECT cycle_id, name FROM public.release_items WHERE id = $1', [itemId]);
      if (existing.rowCount === 0) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
      const lock = await assertCycleNotLocked(existing.rows[0].cycle_id);
      if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 409 });

      const completing = action === 'complete-item';
      await query(`UPDATE public.release_items SET completed_at = ${completing ? 'now()' : 'NULL'}, updated_at = now() WHERE id = $1`, [itemId]);
      logAudit({ actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'release_item', entityId: itemId, entityLabel: existing.rows[0].name, changes: { field: 'completedAt', to: completing ? 'now' : null } });
      return NextResponse.json({ success: true });
    }

    if (action === 'link-ticket' || action === 'unlink-ticket') {
      const check = await assertCanManageHotfixes();
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
      const { actor } = check;
      const { itemId, kind, ticketId } = body;
      if (!itemId || !ticketId || !['internal', 'client'].includes(kind)) {
        return NextResponse.json({ error: 'itemId, kind e ticketId são obrigatórios.' }, { status: 400 });
      }
      const itemRes = await query('SELECT name FROM public.release_items WHERE id = $1', [itemId]);
      if (itemRes.rowCount === 0) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });

      if (kind === 'internal') {
        if (action === 'link-ticket') {
          await query('UPDATE public.internal_tickets SET release_item_id = $1 WHERE id = $2', [itemId, ticketId]);
        } else {
          await query('UPDATE public.internal_tickets SET release_item_id = NULL WHERE id = $1 AND release_item_id = $2', [ticketId, itemId]);
        }
      } else {
        if (action === 'link-ticket') {
          await query('INSERT INTO public.release_item_tickets (release_item_id, ticket_id, created_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [itemId, ticketId, actor.id]);
        } else {
          await query('DELETE FROM public.release_item_tickets WHERE release_item_id = $1 AND ticket_id = $2', [itemId, ticketId]);
        }
      }
      logAudit({
        actorId: actor.id, actorName: actor.name, action: 'update',
        entityType: 'release_item', entityId: itemId, entityLabel: itemRes.rows[0].name,
        changes: { field: 'ticket_link', kind, ticketId, linked: action === 'link-ticket' }
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (err: any) {
    console.error('Error in release-cycles route:', err);
    // 42703 = coluna inexistente — só pode vir de hotfix_cycle_link.sql
    // ainda não aplicada (moratória de banco, ver CLAUDE.md); mensagem
    // específica em vez do genérico, já que é esperado até lá.
    if (err?.code === '42703') {
      return NextResponse.json({ error: 'Vincular hotfix a um ciclo depende de uma migration ainda não aplicada neste ambiente.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Erro ao processar a solicitação.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const check = await assertCanManageHotfixes();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });
    const { actor } = check;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

    const existing = await query('SELECT name, published_at FROM public.release_cycles WHERE id = $1', [id]);
    if (existing.rows[0]?.published_at) {
      return NextResponse.json({ error: 'Este ciclo já foi concluído — fica travado e não pode ser excluído.' }, { status: 409 });
    }
    // ON DELETE CASCADE em release_cycle_stages e release_items (e dali
    // release_item_tickets) — apagar o ciclo limpa tudo sozinho; tickets
    // internos ligados só perdem o vínculo (ON DELETE SET NULL).
    await query('DELETE FROM public.release_cycles WHERE id = $1', [id]);
    logAudit({ actorId: actor.id, actorName: actor.name, action: 'delete', entityType: 'release_cycle', entityId: id, entityLabel: existing.rows[0]?.name || null });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting release cycle:', err);
    return NextResponse.json({ error: 'Erro ao excluir ciclo.' }, { status: 500 });
  }
}
