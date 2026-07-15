import { NextResponse } from 'next/server';
import { WhatsAppService } from '@/lib/services/whatsapp-service';

export async function POST(req: Request) {
  try {
    const { instanceId } = await req.json();
    if (!instanceId) {
      return NextResponse.json({ error: 'instanceId is required' }, { status: 400 });
    }

    await WhatsAppService.disconnect(instanceId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('WhatsApp Logout Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
