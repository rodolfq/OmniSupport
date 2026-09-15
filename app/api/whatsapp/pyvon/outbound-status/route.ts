import { NextRequest, NextResponse } from 'next/server';
import { getCurrentActionUser } from '@/lib/server-auth';
import { PyvonService } from '@/lib/services/pyvon-service';

// Só pra dar transparência ANTES de enviar: mostra pro analista se este
// telefone já está dentro da janela de 24h (mensagem normal funciona) ou se
// vai precisar do template contato_pos_vendas — ver
// app/api/whatsapp/pyvon/start-conversation/route.ts, que decide de novo (e
// com autoridade) na hora de enviar de verdade, sem confiar nesta checagem.
export async function GET(request: NextRequest) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  if (!['Administrador', 'Equipe', 'Time Interno'].includes(actor.role)) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
  }

  const phone = request.nextUrl.searchParams.get('phone') || '';
  if (!phone.trim()) return NextResponse.json({ error: 'Informe o telefone.' }, { status: 400 });

  try {
    const context = await PyvonService.resolveOutboundContext(phone);
    return NextResponse.json({ withinWindow: context.withinWindow });
  } catch (error: any) {
    console.error('[api/whatsapp/pyvon/outbound-status] Failed:', error?.message);
    return NextResponse.json({ error: 'Erro ao checar a janela de 24h.' }, { status: 500 });
  }
}
