import { NextRequest, NextResponse } from 'next/server';
import { MetaWhatsAppService } from '@/lib/services/meta-whatsapp-service';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || 'omnisupport_webhook';
  
  if (mode === 'subscribe' && token === expectedToken) {
    return new NextResponse(challenge);
  }
  
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    await MetaWhatsAppService.handleWebhook(payload);
    return NextResponse.json({ status: 'ok' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}