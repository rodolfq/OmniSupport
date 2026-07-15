import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppService } from '@/lib/services/whatsapp-service';

export async function POST(request: NextRequest) {
  const { instanceId, to, message } = await request.json();

  try {
    await WhatsAppService.sendMessage(instanceId, to, message);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[api/whatsapp/send] Failed:', {
      instanceId,
      to,
      messageLength: message?.length,
      message: error?.message,
      stack: error?.stack
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}