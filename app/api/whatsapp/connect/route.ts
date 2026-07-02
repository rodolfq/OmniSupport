import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppService } from '@/lib/services/whatsapp-service';

export async function POST(request: NextRequest) {
  const { instanceId } = await request.json();
  
  try {
    await WhatsAppService.connect(instanceId || 'default', { manual: true });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const instanceId = searchParams.get('instanceId');
  
  if (!instanceId) {
    return NextResponse.json({ error: 'instanceId required' }, { status: 400 });
  }
  
  const qr = await WhatsAppService.getQR(instanceId);
  return NextResponse.json({ qr });
}