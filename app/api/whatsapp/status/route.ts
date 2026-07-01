import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppService } from '@/lib/services/whatsapp-service';

// GET /api/whatsapp/status?instanceId=xyz
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const instanceId = searchParams.get('instanceId') || 'default';

  const { connected, status, qr } = WhatsAppService.getStatus(instanceId);

  return NextResponse.json({ connected, qr, status });
}

// POST /api/whatsapp/connect
export async function POST(request: NextRequest) {
  const { instanceId } = await request.json();
  const id = instanceId || 'default';
  
  try {
    await WhatsAppService.connect(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}