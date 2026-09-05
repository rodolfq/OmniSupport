import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentActionUser } from '@/lib/server-auth';
import { PyvonService } from '@/lib/services/pyvon-service';

// Inicia conversa fora da janela de 24h via template aprovado (bot-template)
// — botão "Iniciar conversa por WhatsApp" no chamado/empresa. Ação de
// atendimento (mandar mensagem pro cliente), não de configuração — por isso
// exige só ser da equipe interna, não whatsapp:manage (que é sobre
// configurar o canal em si).
export async function POST(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  if (!['Administrador', 'Equipe', 'Time Interno'].includes(actor.role)) {
    return NextResponse.json({ error: 'Você não tem permissão para iniciar conversas por WhatsApp.' }, { status: 403 });
  }

  try {
    const { templateName, phone, cadastroId, name, language, variables, channelId, contentPreview } = await request.json();
    if (!templateName?.trim()) return NextResponse.json({ error: 'Escolha um template.' }, { status: 400 });
    if (!phone && !cadastroId) return NextResponse.json({ error: 'Informe o telefone do cliente.' }, { status: 400 });

    const instRes = await query(`SELECT id FROM public.whatsapp_instances WHERE provider = 'pyvon' LIMIT 1`);
    const instanceId = instRes.rows[0]?.id;
    if (!instanceId) return NextResponse.json({ error: 'Nenhum canal Pyvon configurado (Configurações > WhatsApp).' }, { status: 400 });

    const result = await PyvonService.sendTemplate(instanceId, {
      templateName: templateName.trim(),
      phone: phone || undefined,
      cadastroId: cadastroId || undefined,
      name: name || undefined,
      language: language || 'pt_BR',
      variables: variables || undefined,
      channelId: channelId || undefined,
      contentPreview: contentPreview || undefined
    });

    if (result?.skipped) {
      // 200 "aceito" mas nada foi enviado (modo de teste do tenant, ou
      // homologação com contato não marcado como teste) — nunca registrar
      // como se tivesse sido entregue.
      // 422 (não 502): Cloudflare intercepta qualquer resposta 502/503/504 do
      // servidor de origem e a substitui pela própria página de erro
      // genérica dele, mesmo quando o 502 é intencional (não uma falha real
      // de infra) — descoberto testando através do túnel: localhost via
      // direto respondia certo, mas pelo túnel a resposta virava HTML da
      // Cloudflare, escondendo esta mensagem de erro.
      return NextResponse.json({ error: `Pyvon não enviou o template (${result.skipped}).` }, { status: 422 });
    }

    if (result?.cadastro_id) {
      await PyvonService.recordOutboundTemplateMessage({
        instanceId,
        phone: phone || undefined,
        cadastroId: result.cadastro_id,
        customerName: name || 'Cliente',
        analystId: actor.id,
        analystName: actor.name,
        text: contentPreview || `[template ${templateName.trim()}]`
      });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    const status = error?.response?.status;
    const message = error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Falha ao iniciar conversa via template.';
    console.error('[api/whatsapp/pyvon/send-template] Failed:', { status, message });
    // Nunca 502/503/504 aqui — ver comentário acima sobre Cloudflare reescrever essas respostas.
    return NextResponse.json({ error: message }, { status: status && status < 500 ? status : 422 });
  }
}
