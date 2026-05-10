import { NextResponse } from 'next/server';
import { whatsappManager } from '@/lib/whatsapp-manager';

export async function POST(req: Request) {
  try {
    const { sessionId, to, text } = await req.json();
    
    if (!sessionId || !to || !text) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    await whatsappManager.sendMessage(sessionId, to, text);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('WhatsApp Send Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
