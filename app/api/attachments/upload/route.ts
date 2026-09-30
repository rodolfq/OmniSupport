import { NextRequest, NextResponse } from 'next/server';
import { getCurrentActionUser } from '@/lib/server-auth';
import { storeAttachmentBuffer } from '@/lib/services/attachment-storage';
import { MAX_ATTACHMENT_TOTAL_BYTES, MAX_ATTACHMENT_TOTAL_LABEL } from '@/lib/attachment-limits';

// Upload de anexo de VERDADE (multipart/form-data) — substitui o caminho
// antigo de todo ponto que anexa arquivo (chat, chamado, ticket interno,
// chat interno): o client lia o arquivo inteiro como `data:` URL (base64) e
// mandava embutido no JSON da própria mensagem/chamado. Achado em
// 2026-09-30: um arquivo de 125MB (dentro do teto de 220MB de
// lib/attachment-limits.ts) travava a aba do navegador durante essa
// conversão — FileReader.readAsDataURL monta a string inteira (~33% maior
// que o arquivo) na memória da aba, na thread principal, sem Web Worker.
//
// Aqui o navegador transmite o Blob em stream via fetch()+FormData, sem
// nunca virar uma string JS gigante — e esta rota grava direto em disco
// (mesmo lib/services/attachment-storage.ts de sempre) e devolve a URL
// curta. Como essa URL NUNCA é `data:`, persistAttachment (chamado por
// TODA rota de mensagem/chamado na hora de salvar) já a repassa sem
// reprocessar — é por isso que nenhuma dessas rotas precisou mudar.
//
// Autorização: só exige sessão válida, igual a qualquer outro ponto de
// escrita de anexo hoje (a autorização de ONDE o anexo pode ser usado
// continua sendo checada na rota que de fato cria a mensagem/chamado —
// esta rota só grava bytes em disco, não vincula a nada). Um upload feito
// e nunca anexado a uma mensagem vira, no máximo, lixo em disco — mesmo
// risco aceito já documentado em attachment-storage.ts.
export async function POST(request: NextRequest) {
  const actor = await getCurrentActionUser();
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Arquivo vazio.' }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
      return NextResponse.json({ error: `Arquivo excede o limite de ${MAX_ATTACHMENT_TOTAL_LABEL}.` }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    const stored = await storeAttachmentBuffer(buffer, mimeType, file.name);

    return NextResponse.json({
      id: crypto.randomUUID(),
      name: file.name || 'arquivo',
      type: mimeType,
      url: stored.url,
      size: stored.size
    });
  } catch (error: any) {
    console.error('[attachments/upload] Falha ao gravar anexo:', error);
    return NextResponse.json({ error: 'Erro ao enviar arquivo.' }, { status: 500 });
  }
}
