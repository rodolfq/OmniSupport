import { NextRequest, NextResponse } from 'next/server';
import { EmailService } from '@/lib/services/email-service';

export async function POST(request: NextRequest) {
  const { to, subject, html } = await request.json();

  try {
    await EmailService.send(to, subject, html);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[api/email/send] Failed:', { to, subject, message: error?.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
