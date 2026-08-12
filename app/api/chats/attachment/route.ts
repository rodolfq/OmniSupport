import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { Attachment } from '@/lib/types';
import { ATTACHMENT_URL_PREFIX, parseDataUrl, readAttachmentFile } from '@/lib/services/attachment-storage';
import { lookup as lookupMime } from '@/lib/mime-types';

// Serve um anexo de chat por messageId+attachmentId — usado pelo link "Baixar
// arquivo" no PDF do Histórico de Conversas, que precisa de uma URL estável e
// curta (um data: URL gigante não funciona como link clicável na maioria dos
// leitores de PDF).
//
// Anexo novo mora em disco (volume, ver lib/services/attachment-storage.ts) e
// esta rota vira um atalho pra /api/files/...; anexo antigo ainda é data: URL
// no banco e continua sendo decodificado aqui, enquanto a migração não passar
// por ele (scripts/migrate-attachments-to-disk.js).
//
// Autenticada pelo middleware.ts como qualquer rota do portal — antes ficava
// aberta a quem soubesse o messageId, o que num anexo de atendimento pode ser
// documento de cliente.
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
    if (!attachment?.url) {
      return NextResponse.json({ error: 'Anexo não encontrado.' }, { status: 404 });
    }

    let buffer: Buffer | null = null;
    let mime = attachment.type || 'application/octet-stream';

    const parsed = parseDataUrl(attachment.url);
    if (parsed) {
      buffer = parsed.buffer;
      mime = parsed.mimeType || mime;
    } else if (attachment.url.startsWith(ATTACHMENT_URL_PREFIX)) {
      const relativePath = attachment.url.slice(ATTACHMENT_URL_PREFIX.length);
      buffer = await readAttachmentFile(relativePath);
      if (buffer && !attachment.type) mime = lookupMime(relativePath);
    }

    if (!buffer) {
      return NextResponse.json({ error: 'Anexo não encontrado.' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(buffer), {
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
