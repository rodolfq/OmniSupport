import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentActionUser } from '@/lib/server-auth';
import { PyvonService } from '@/lib/services/pyvon-service';

// Ponto único de "iniciar conversa por telefone" — usado pelo botão "Iniciar
// Conversa" (Empresas > Decisor), pelo WhatsApp de cada funcionário (Empresas)
// e pelo "+ Novo WhatsApp" do chat widget.
//
// Escolha do canal (2026-10-06): 'whatsapp' (padrão) abre a conversa no
// WhatsApp via Pyvon — decide sozinho se manda o template contato_pos_vendas
// antes (fora da janela de 24h). 'portal' abre a conversa no chat do portal
// com o cadastro do contato, para quem já trocou a senha provisória (ver
// eligibility abaixo) — quem não usa o portal só recebe pelo WhatsApp.
//
// Antes esta rota sempre abria a conversa do WhatsApp, mas a busca por telefone
// podia achar a conversa do PORTAL aberta do mesmo número e anexar o envio nela
// — a mensagem aparecia como enviada e nunca saía. Agora a busca do Pyvon só
// enxerga sessões do canal 'pyvon' (ver pyvon-service.ts).

type Channel = 'whatsapp' | 'portal';

function phoneDigits(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

// Mesmas duas formas do número que o resto do sistema aceita (com e sem DDI 55).
function phoneCandidates(phone: string): string[] {
  const digits = phoneDigits(phone);
  if (!digits) return [];
  const withoutCountry = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  return Array.from(new Set([withoutCountry, `55${withoutCountry}`]));
}

// Quem pode ser chamado pelo portal: perfil de cliente/funcionário que já
// trocou a senha provisória (must_change_password = false). Em 2026-10-06, só
// 19 de 461 perfis de empresa estavam nessa condição — o restante nunca entrou.
async function findPortalProfileByPhone(phone: string): Promise<{ id: string; name: string; eligible: boolean } | null> {
  const candidates = phoneCandidates(phone);
  if (!candidates.length) return null;
  const res = await query(
    `SELECT id, name, must_change_password, role FROM public.profiles
      WHERE role IN ('Cliente', 'Funcionário')
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ANY($1::text[])
      ORDER BY must_change_password ASC
      LIMIT 1`,
    [candidates]
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, eligible: row.must_change_password === false };
}

// GET ?phone= — o modal consulta antes de mostrar a opção "Portal", para
// esconder ou desabilitar quando o contato ainda não usa o portal.
export async function GET(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  if (!['Administrador', 'Equipe', 'Time Interno'].includes(actor.role)) {
    return NextResponse.json({ error: 'Você não tem permissão para iniciar conversas por WhatsApp.' }, { status: 403 });
  }
  const phone = new URL(request.url).searchParams.get('phone') || '';
  const profile = await findPortalProfileByPhone(phone);
  return NextResponse.json({
    portalProfileId: profile?.eligible ? profile.id : null,
    portalEligible: !!profile?.eligible,
    portalProfileName: profile?.name || null
  });
}

export async function POST(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  if (!['Administrador', 'Equipe', 'Time Interno'].includes(actor.role)) {
    return NextResponse.json({ error: 'Você não tem permissão para iniciar conversas por WhatsApp.' }, { status: 403 });
  }

  try {
    const { phone, name, channel: rawChannel, profileId } = await request.json();
    if (!phone?.trim()) return NextResponse.json({ error: 'Informe o telefone do cliente.' }, { status: 400 });
    const channel: Channel = rawChannel === 'portal' ? 'portal' : 'whatsapp';

    if (channel === 'portal') {
      // Portal: nunca manda template nem fala com o WhatsApp. Usa o perfil
      // informado (ou o encontrado pelo telefone), desde que já use o portal.
      const profile = profileId
        ? await query(`SELECT id, name, must_change_password, role FROM public.profiles WHERE id = $1`, [profileId])
            .then(r => r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].name, eligible: r.rows[0].must_change_password === false && ['Cliente', 'Funcionário'].includes(r.rows[0].role) } : null)
        : await findPortalProfileByPhone(phone);
      if (!profile?.eligible) {
        return NextResponse.json(
          { error: 'Este contato ainda não usa o portal (não trocou a senha provisória). Use o canal WhatsApp.' },
          { status: 422 }
        );
      }

      const existing = await query(
        `SELECT id FROM public.chat_sessions
          WHERE customer_id = $1 AND channel = 'widget' AND status <> 'closed'
          ORDER BY updated_at DESC LIMIT 1`,
        [profile.id]
      );
      if (existing.rows[0]) {
        await query(
          `UPDATE public.chat_sessions SET assignee_id = COALESCE(assignee_id, $2), status = 'active', updated_at = NOW() WHERE id = $1`,
          [existing.rows[0].id, actor.id]
        );
        return NextResponse.json({ sessionId: existing.rows[0].id, usedTemplate: false });
      }

      const newId = crypto.randomUUID();
      const inserted = await query(
        `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, status, queue_id, assignee_id, channel, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', NULL, $5, 'widget', NOW(), NOW())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [newId, profile.id, profile.name, phoneDigits(phone), actor.id]
      );
      const sessionId = inserted.rows[0]?.id
        || (await query(
          `SELECT id FROM public.chat_sessions WHERE customer_id = $1 AND channel = 'widget' AND status <> 'closed' LIMIT 1`,
          [profile.id]
        )).rows[0]?.id;
      if (!sessionId) return NextResponse.json({ error: 'Não foi possível abrir a conversa no portal.' }, { status: 422 });
      return NextResponse.json({ sessionId, usedTemplate: false });
    }

    const instRes = await query(`SELECT id FROM public.whatsapp_instances WHERE provider = 'pyvon' LIMIT 1`);
    const instanceId = instRes.rows[0]?.id;
    if (!instanceId) return NextResponse.json({ error: 'Nenhum canal Pyvon configurado (Configurações > WhatsApp).' }, { status: 400 });

    const result = await PyvonService.startConversation(instanceId, {
      phone: phone.trim(),
      name: name?.trim() || undefined,
      actorId: actor.id,
      actorName: actor.name
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    // data.error às vezes é BOOLEANO no contrato do Pyvon (flag, não
    // mensagem) — pegar ele direto virava um toast "true" no client (new
    // Error(true).message === "true"). data.message é o texto de verdade;
    // só cai pro campo "error" quando ele também for string.
    const message = (typeof data?.message === 'string' && data.message)
      || (typeof data?.error === 'string' && data.error)
      || error?.message
      || 'Falha ao iniciar conversa.';
    console.error('[api/whatsapp/pyvon/start-conversation] Failed:', { status, data, message });
    // Nunca 502/503/504 (Cloudflare reescreve pela própria página de erro
    // genérica — ver mesmo comentário em send-template/route.ts).
    return NextResponse.json({ error: message }, { status: status && status < 500 ? status : 422 });
  }
}
