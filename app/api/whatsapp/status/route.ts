import { NextResponse } from 'next/server';
import { whatsappManager } from '@/lib/whatsapp-manager';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
  }

  const status = whatsappManager.getStatus(sessionId);
  return NextResponse.json(status);
}
