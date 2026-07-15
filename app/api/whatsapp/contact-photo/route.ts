import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppService } from '@/lib/services/whatsapp-service';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const instanceId = searchParams.get('instanceId') || 'default';
  const phone = searchParams.get('phone');

  if (!phone) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 });
  }

  const url = await WhatsAppService.getProfilePicture(instanceId, phone);
  return NextResponse.json({ url });
}
