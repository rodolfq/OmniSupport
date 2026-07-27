import { NextRequest, NextResponse } from 'next/server';
import { EmailService } from '@/lib/services/email-service';

export async function POST(request: NextRequest) {
  const { to } = await request.json();

  try {
    await EmailService.sendTest(to);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[api/email/test] Failed:', { to, message: error?.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
