import { NextResponse } from 'next/server';
import { assertCanManageWhatsapp, permissionErrorStatus } from '@/lib/server-permissions';
import { PyvonService } from '@/lib/services/pyvon-service';

// Testa o segredo salvo chamando GET /api/webhook/channels de verdade — mesmo
// padrão de /api/whatsapp/meta/test (usa a credencial já salva no servidor,
// nunca reenviada pelo client).
export async function POST(request: Request) {
  const check = await assertCanManageWhatsapp();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

  const { instanceId } = await request.json();
  if (!instanceId) return NextResponse.json({ error: 'instanceId é obrigatório.' }, { status: 400 });

  try {
    const channels = await PyvonService.listChannels(instanceId);
    return NextResponse.json({ success: true, channels });
  } catch (error: any) {
    const message = error?.response?.data?.message || error?.message || 'Falha ao testar conexão com o Pyvon.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
