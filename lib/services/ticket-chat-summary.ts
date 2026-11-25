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
// terminou. Mesmo modelo (summarizeTranscriptWithAi), mas com instrução e
// formato próprios (TICKET_SUMMARY_INSTRUCTION, 2026-11-24).
//
// Roda em SEGUNDO PLANO, depois de o chamado já ter sido criado e devolvido
// à tela: a IA leva alguns segundos e pode falhar (cota/429). Falhar aqui
// nunca desfaz nem atrasa o chamado — só deixa a descrição como estava, com
// o motivo no log do servidor.

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 20_000;

// Formato pedido pelo usuário em 2026-11-24 para a descrição do chamado.
// "Central" = empresa-cliente (vem do cadastro do chamado, passada como fato);
// "Cliente" = o cliente FINAL dessa empresa, que aparece na conversa. Linha
// sem informação na conversa fica "—": nunca inventar login/senha/nome.
const TICKET_SUMMARY_INSTRUCTION = `Você registra, na descrição de um chamado de suporte do SSX, o resumo de uma conversa de atendimento. Responda SEMPRE em português do Brasil, EXATAMENTE neste formato, sem nada antes ou depois:

SSX
Central: <nome da empresa-cliente>
Cliente: <nome do cliente final da empresa>
Login: <login>
Senha: <senha>

Resumo: <de 3 a 6 frases em texto corrido: motivo do contato, o que foi feito/informado e como terminou (resolvido, pendente, escalado etc.)>

Regras:
- "Central" é a empresa-cliente atendida. Use o nome informado em "Empresa do chamado" quando houver; senão, o que a conversa disser.
- "Cliente" é o cliente FINAL dessa empresa (a pessoa/empresa que ela atende), não a pessoa que está conversando com o suporte. Normalmente o contato ou o analista o menciona na conversa ("o cliente X", "o veículo do cliente Y"). Se não aparecer, escreva "—".
- "Login" e "Senha": só se aparecerem escritos na conversa, copiados exatamente como estão. Se não aparecerem, escreva "—".
- Baseie-se só no que está na conversa. Nunca invente nome, login, senha, número de chamado ou fato.`;

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

  // Empresa do chamado (cadastro), com a do contato da conversa de reserva.
  const companyRes = await query(
    `SELECT COALESCE(ct.name, cs_co.name) AS company_name
       FROM public.tickets t
       LEFT JOIN public.companies ct ON ct.id = t.company_id
       LEFT JOIN public.chat_sessions s ON s.id = $2
       LEFT JOIN public.profiles p ON p.id = s.customer_id
       LEFT JOIN public.companies cs_co ON cs_co.id = p.company_id
      WHERE t.id = $1`,
    [ticketId, sessionId]
  ).catch(() => ({ rows: [] as any[] }));
  const companyName: string | null = companyRes.rows[0]?.company_name || null;

  let summary: string | null = null;
  let lastError: any = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !summary; attempt++) {
    try {
      summary = await summarizeTranscriptWithAi(transcript, customerName, {
        systemInstruction: TICKET_SUMMARY_INSTRUCTION,
        context: `Empresa do chamado: ${companyName || '(não informada no cadastro)'}`
      });
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

  // Cada linha do formato (SSX / Central / Cliente / Login / Senha / Resumo)
  // vira uma linha na descrição; bloco separado por linha em branco vira
  // parágrafo. Não diz que é IA (pedido de 2026-11-11 — a descrição é visível
  // ao cliente); a origem fica no log interno abaixo.
  const block = summary.split(/\n{2,}/).map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');

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
