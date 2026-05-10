import { NextResponse } from 'next/server';
import { whatsappManager } from '@/lib/whatsapp-manager';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    await whatsappManager.logout(sessionId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('WhatsApp Logout Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
