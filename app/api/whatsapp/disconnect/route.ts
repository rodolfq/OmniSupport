import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppService } from '@/lib/services/whatsapp-service';

export async function POST(request: NextRequest) {
  const { instanceId } = await request.json();
  
  try {
    await WhatsAppService.disconnect(instanceId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}