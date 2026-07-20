import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { Attachment } from '@/lib/types';

// Serve um anexo de chat (hoje guardado como data: URL em
// chat_messages.metadata.attachments) por uma URL HTTP de verdade — usado
// pelo link "Baixar arquivo" no PDF do Histórico de Conversas, já que um
// data: URL gigante não funciona como link clicável na maioria dos leitores
// de PDF. Mesmo padrão de acesso (sem autenticação extra) das demais rotas
// internas já existentes neste projeto (/api/tickets, /api/users etc.).
export async function GET(request: NextRequest) {
  const messageId = request.nextUrl.searchParams.get('messageId');
  const attachmentId = request.nextUrl.searchParams.get('attachmentId');

  if (!messageId || !attachmentId) {
    return NextResponse.json({ error: 'messageId e attachmentId são obrigatórios.' }, { status: 400 });
  }

  try {
    const res = await query('SELECT metadata FROM public.chat_messages WHERE id = $1', [messageId]);
    const row = res.rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 });
    }

    const attachments: Attachment[] = row.metadata?.attachments || [];
    const attachment = attachments.find(a => a.id === attachmentId);
    if (!attachment || !attachment.url?.startsWith('data:')) {
      return NextResponse.json({ error: 'Anexo não encontrado.' }, { status: 404 });
    }

    const [header, payload = ''] = attachment.url.split(',');
    const isBase64 = /;base64/i.test(header);
    const mime = header.match(/^data:([^;,]+)/)?.[1] || attachment.type || 'application/octet-stream';
    const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf-8');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.name || 'arquivo')}"`,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error: any) {
    console.error('[chats/attachment] Erro ao servir anexo:', error);
    return NextResponse.json({ error: 'Erro ao carregar anexo.' }, { status: 500 });
  }
}
