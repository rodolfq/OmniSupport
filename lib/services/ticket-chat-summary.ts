import { query } from '@/lib/db';
import { summarizeTranscriptWithAi } from './chat-summary-service';

// Resumo da conversa na descrição do chamado gerado pelo chat (2026-11-11,
// pedido do usuário). Só para chamado que nasce ABERTO — com "Fechar
// imediatamente" marcado não roda (decisão do usuário: ninguém vai trabalhar
// nesse chamado, não vale gastar cota de IA).
//
// Por que gera aqui e não reaproveita o resumo do Histórico de Conversas:
// aquele só existe DEPOIS que a conversa é encerrada (chat_histories), e o
// chamado nasce antes — no "Gerar Chamado" sem finalizar a conversa nem
// terminou. Mesmo modelo e mesmas instruções (summarizeTranscriptWithAi),
// então o texto tem o mesmo jeito do "Chat Resumido".
//
// Roda em SEGUNDO PLANO, depois de o chamado já ter sido criado e devolvido
// à tela: a IA leva alguns segundos e pode falhar (cota/429). Falhar aqui
// nunca desfaz nem atrasa o chamado — só deixa a descrição como estava, com
// o motivo no log do servidor.

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 20_000;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Transcrição da conversa como texto, no mesmo formato "[data hora] Nome: texto"
 * do histórico. NOTA INTERNA (type 'internal') e mensagem de sistema ficam de
 * fora de propósito: a descrição do chamado é VISÍVEL AO CLIENTE no portal, e
 * um resumo feito em cima da nota interna vazaria o que a equipe escreveu só
 * para ela.
 */
async function buildSessionTranscript(sessionId: string): Promise<{ transcript: string; customerName: string | null }> {
  const [sessionRes, msgsRes] = await Promise.all([
    query('SELECT customer_name FROM public.chat_sessions WHERE id = $1', [sessionId]),
    query(
      `SELECT sender_name, text, type, metadata, created_at
         FROM public.chat_messages
        WHERE session_id = $1
          AND COALESCE(type, 'text') NOT IN ('internal', 'system', 'system_log')
        ORDER BY created_at ASC`,
      [sessionId]
    )
  ]);
  const customerName: string | null = sessionRes.rows[0]?.customer_name || null;

  const lines: string[] = [];
  for (const m of msgsRes.rows) {
    const parts: string[] = [];
    // Texto com imagem colada (base64) nunca deveria chegar aqui, mas se
    // chegar não pode ir inteiro pro modelo (foi o que travou a CPU em 11/11).
    const text = String(m.text || '').replace(/data:[^\s"'<>)]+/g, '[imagem]').trim();
    if (text) parts.push(text);
    const attachments = Array.isArray(m.metadata?.attachments) ? m.metadata.attachments : [];
    for (const a of attachments) {
      // Áudio já transcrito entra como texto — muitas vezes é ali que está o
      // problema que o cliente descreveu.
      if (a?.transcription) parts.push(`[áudio] ${String(a.transcription).trim()}`);
      else parts.push(`[anexo: ${a?.name || 'arquivo'}]`);
    }
    if (parts.length === 0) continue;
    lines.push(`[${formatTime(new Date(m.created_at))}] ${m.sender_name || 'Sem nome'}: ${parts.join(' ')}`);
  }
  return { transcript: lines.join('\n'), customerName };
}

export async function fillTicketDescriptionFromChat(ticketId: string, sessionId: string): Promise<void> {
  const { transcript, customerName } = await buildSessionTranscript(sessionId);
  if (!transcript.trim()) return; // conversa sem nenhuma mensagem do cliente/equipe

  let summary: string | null = null;
  let lastError: any = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !summary; attempt++) {
    try {
      summary = await summarizeTranscriptWithAi(transcript, customerName);
    } catch (err: any) {
      lastError = err;
      // Só vale tentar de novo quando é cota/instabilidade (429/5xx); chave
      // ausente ou resposta vazia não melhora esperando.
      const status = Number(err?.status || err?.response?.status || 0);
      const transient = status === 429 || status >= 500;
      if (!transient || attempt === MAX_ATTEMPTS) break;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  if (!summary) {
    console.error(`[ticket-chat-summary] Sem resumo para o chamado ${ticketId}:`, lastError?.message || lastError);
    return;
  }

  const paragraphs = summary.split(/\n{2,}/).map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  // Só "Resumo do atendimento", sem dizer que é IA (pedido do usuário,
  // 2026-11-11) — a descrição é visível ao cliente. A origem fica registrada
  // no log interno abaixo.
  const block = `<p><strong>Resumo do atendimento</strong></p>${paragraphs}`;

  // Descrição vazia: vira o resumo. Se alguém já escreveu nela nesses
  // segundos, o resumo entra DEPOIS do texto, sem apagar nada.
  const res = await query(
    `UPDATE public.tickets
        SET description = CASE
              WHEN COALESCE(btrim(description), '') IN ('', '<p></p>') THEN $2
              ELSE description || '<hr>' || $2
            END
      WHERE id = $1
      RETURNING created_by`,
    [ticketId, block]
  );
  if (!res.rowCount) return; // chamado apagado nesse meio-tempo

  // Registro na aba "Logs de Alteração" (interno), pra ninguém achar que um
  // analista escreveu esse texto. Autor = quem gerou o chamado: com autor
  // NULL, o contador de "Meus Chamados" (notifications/badges) contaria o log
  // como novidade e acenderia o aviso do responsável a cada chamado do chat.
  await query(
    `INSERT INTO public.ticket_messages (ticket_id, author_id, content, type, is_visible_to_customer)
     VALUES ($1, $3, $2, 'system', false)`,
    [ticketId, 'Descrição preenchida automaticamente com o resumo da conversa (gerado por IA).', res.rows[0]?.created_by || null]
  ).catch(err => console.error('[ticket-chat-summary] Falha ao registrar log no chamado:', err));
}
