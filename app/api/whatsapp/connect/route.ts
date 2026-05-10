import { NextResponse } from 'next/server';
import { whatsappManager } from '@/lib/whatsapp-manager';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { sessionId, name, force } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    console.log(`[API:Connect] Session: ${sessionId}, Name: ${name}, Force: ${force}`);
    await whatsappManager.connect(sessionId, name || 'WhatsApp Instance', !!force);
    console.log(`[API:Connect] Connection call finished for ${sessionId}`);
    const status = whatsappManager.getStatus(sessionId);

    return NextResponse.json(status);
  } catch (error: any) {
    console.error('WhatsApp Connect Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
