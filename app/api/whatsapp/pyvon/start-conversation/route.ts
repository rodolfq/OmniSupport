import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentActionUser } from '@/lib/server-auth';
import { PyvonService } from '@/lib/services/pyvon-service';

// Ponto único de "iniciar conversa por telefone" pro canal Pyvon — usado pelo
// botão "Iniciar Conversa" (Empresas > Decisor) e pelo "+ Novo WhatsApp" do
// chat widget. Decide sozinho (PyvonService.startConversation) se abre normal
// ou se precisa do template contato_pos_vendas primeiro; nunca fica a cargo
// de quem chama escolher.
export async function POST(request: Request) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  if (!['Administrador', 'Equipe', 'Time Interno'].includes(actor.role)) {
    return NextResponse.json({ error: 'Você não tem permissão para iniciar conversas por WhatsApp.' }, { status: 403 });
  }

  try {
    const { phone, name } = await request.json();
    if (!phone?.trim()) return NextResponse.json({ error: 'Informe o telefone do cliente.' }, { status: 400 });

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
