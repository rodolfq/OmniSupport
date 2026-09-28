import { query } from '../db';
import { emitChatEvent } from '../chat-events';
import { notifyUser } from './push-service';

/**
 * Aviso assíncrono de entrega do Pyvon (POST /api/whatsapp/pyvon-status).
 *
 * O Pyvon aceita o envio na hora (bot-template/bot-response respondem 2xx) e a
 * Meta só recusa DEPOIS — número sem WhatsApp, template pausado, janela de 24h
 * etc. Até o contrato v1.15 isso não chegava até nós: o disparo ficava "sent"
 * no nosso log e o cliente nunca recebia (chamado #3394, 2026-09-25/28). Aqui
 * recebemos esse aviso e tratamos a falha.
 *
 * O formato do payload é o que o Pyvon definiu do lado deles, e ainda pode
 * mudar — por isso a leitura é tolerante (vários nomes de campo, erro em texto
 * ou objeto) e TODO evento recebido é gravado cru em pyvon_delivery_events,
 * mesmo sem casar com nenhuma mensagem nossa. Só o que é falha mexe no resto.
 */

export type DeliveryStatus = 'failed' | 'sent' | 'delivered' | 'read' | 'unknown';

export interface ParsedDeliveryEvent {
  messageId: string | null;
  cadastroId: number | null;
  status: DeliveryStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

function firstDefined(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// Aceita o evento na raiz, dentro de `data`/`event`, ou como primeiro item de
// uma lista (`statuses`, `events`, ou o próprio corpo sendo um array).
function unwrap(payload: any): any {
  if (Array.isArray(payload)) return unwrap(payload[0]);
  if (!payload || typeof payload !== 'object') return {};
  if (firstDefined(payload, ['message_id', 'messageId'])) return payload;
  for (const key of ['data', 'event', 'payload', 'statuses', 'events']) {
    const inner = payload[key];
    if (Array.isArray(inner) && inner[0] && typeof inner[0] === 'object') return { ...payload, ...inner[0] };
    if (inner && typeof inner === 'object') return { ...payload, ...inner };
  }
  return payload;
}

function statusFromText(raw: string): DeliveryStatus {
  const s = raw.toLowerCase();
  // "undelivered" contém "delivered": testar as falhas antes.
  if (/fail|error|undeliver|not_sent|not sent|reject|refus|recus|falh|erro/.test(s)) return 'failed';
  if (/\bread\b|\blid[oa]\b/.test(s)) return 'read';
  if (/deliver|entreg/.test(s)) return 'delivered';
  if (/\bsent\b|enviad/.test(s)) return 'sent';
  return 'unknown';
}

export function parseDeliveryStatusPayload(payload: any): ParsedDeliveryEvent {
  const body = unwrap(payload);

  const rawMessageId = firstDefined(body, ['message_id', 'messageId']);
  const rawCadastro = firstDefined(body, ['cadastro_id', 'cadastroId']);
  const cadastroNum = rawCadastro !== undefined ? Number(rawCadastro) : NaN;

  // Erro: texto, objeto ({ code, message|title }) ou lista de objetos (estilo Meta).
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  // Booleano (`error: true`) é flag, não texto: pula e procura o motivo nos outros campos.
  let errorSource: any;
  for (const key of ['error', 'delivery_error', 'error_message', 'error_details', 'failure_reason', 'reason', 'errors']) {
    const v = body?.[key];
    if (v !== undefined && v !== null && v !== '' && typeof v !== 'boolean') { errorSource = v; break; }
  }
  const errorItem = Array.isArray(errorSource) ? errorSource[0] : errorSource;
  if (typeof errorItem === 'string') {
    errorMessage = errorItem.trim() || null;
  } else if (errorItem && typeof errorItem === 'object') {
    const code = firstDefined(errorItem, ['code', 'error_code']);
    if (code !== undefined) errorCode = String(code);
    const text = firstDefined(errorItem, ['message', 'title', 'detail', 'details', 'error_data']);
    errorMessage = typeof text === 'string' ? text.trim() : (text && typeof text === 'object' ? JSON.stringify(text) : null);
    if (!errorMessage && code !== undefined) errorMessage = `Erro ${code}`;
  }
  const errorFlag = body?.error === true || body?.ok === false || body?.success === false;

  const explicitCode = firstDefined(body, ['error_code', 'code']);
  if (explicitCode !== undefined && !errorCode) errorCode = String(explicitCode);
  if (!errorCode && errorMessage) {
    // "(#131047) Re-engagement message" / "waba_131037: ..." / "código 131026"
    const m = errorMessage.match(/\(#(\d{3,6})\)|waba_(\d{3,6})|\b(13\d{4})\b/);
    if (m) errorCode = m[1] || m[2] || m[3];
  }

  const rawStatus = firstDefined(body, ['status', 'delivery', 'delivery_status', 'state', 'event', 'type']);
  let status: DeliveryStatus = typeof rawStatus === 'string' ? statusFromText(rawStatus) : 'unknown';
  if (status === 'unknown' && (errorMessage || errorCode || errorFlag)) status = 'failed';

  return {
    messageId: rawMessageId !== undefined ? String(rawMessageId) : null,
    cadastroId: Number.isFinite(cadastroNum) ? cadastroNum : null,
    status,
    errorCode,
    errorMessage
  };
}

// Dica em português pros códigos da Meta que mais aparecem; o texto original
// do Pyvon/Meta vai sempre junto — a dica só ajuda a agir.
const META_CODE_HINTS: Record<string, string> = {
  '131026': 'número não recebe mensagens (sem WhatsApp, número inválido ou versão antiga do app)',
  '131047': 'fora da janela de 24h — só template aprovado é aceito',
  '131049': 'a Meta optou por não entregar (limite de mensagens ao contato / qualidade)',
  '131037': 'nome de exibição do número ainda não aprovado na Meta',
  '131042': 'problema de pagamento na conta da Meta',
  '132000': 'quantidade de variáveis diferente da do template',
  '132001': 'template inexistente para o idioma informado',
  '132015': 'template pausado pela Meta (baixa qualidade)',
  '132016': 'template desativado pela Meta'
};

export function describeDeliveryFailure(event: Pick<ParsedDeliveryEvent, 'errorCode' | 'errorMessage'>): string {
  const original = event.errorMessage || (event.errorCode ? `Erro ${event.errorCode}` : 'sem motivo informado');
  const hint = event.errorCode ? META_CODE_HINTS[event.errorCode] : null;
  return hint ? `${original} — ${hint}` : original;
}

const TEAM_ROLES = ['Administrador', 'Equipe', 'Time Interno'];

// Tudo o que a falha muda do nosso lado. Idempotente: se o Pyvon repetir o
// aviso, nada é regravado nem notificado de novo (cada UPDATE só pega o que
// ainda não estava marcado como falha).
async function applyDeliveryFailure(messageId: string, event: ParsedDeliveryEvent): Promise<string[]> {
  const handled: string[] = [];
  const reason = describeDeliveryFailure(event);
  const notifyIds = new Set<string>();
  let customerLabel = 'o cliente';
  let ticketId: string | null = null;

  // 1) Mensagem já dentro de uma conversa do chat: vira "não entregue" na tela.
  const chatRes = await query(
    `UPDATE public.chat_messages SET whatsapp_status = 'failed', whatsapp_error = $2
      WHERE pyvon_message_id = $1 AND whatsapp_status IS DISTINCT FROM 'failed'
      RETURNING id, session_id, sender_id`,
    [messageId, reason]
  );
  for (const row of chatRes.rows) {
    handled.push('chat');
    emitChatEvent(row.session_id, { type: 'receipt', sessionId: row.session_id });
    if (row.sender_id) notifyIds.add(row.sender_id);
    const sess = await query('SELECT customer_name FROM public.chat_sessions WHERE id = $1', [row.session_id]);
    if (sess.rows[0]?.customer_name) customerLabel = sess.rows[0].customer_name;
  }

  // 2) Template guardado à espera do cliente responder: o cliente nunca o
  //    recebeu, então não deve virar "histórico" de uma conversa futura.
  const pendingRes = await query(
    'DELETE FROM public.pyvon_pending_outbound WHERE pyvon_message_id = $1 RETURNING customer_name, note_author_id',
    [messageId]
  );
  for (const row of pendingRes.rows) {
    handled.push('pendente');
    if (row.note_author_id) notifyIds.add(row.note_author_id);
    if (row.customer_name) customerLabel = row.customer_name;
  }

  // 3) Disparo da automação: deixa de constar como "sent" e registra o motivo
  //    no histórico do chamado (aba Logs de Alteração).
  const dispatchRes = await query(
    `UPDATE public.automation_dispatches SET status = 'failed', error = $2
      WHERE pyvon_message_id = $1 AND status <> 'failed'
      RETURNING ticket_id, recipient_name`,
    [messageId, `Falha na entrega (Pyvon/Meta): ${reason}`]
  );
  for (const row of dispatchRes.rows) {
    handled.push('disparo');
    if (row.recipient_name) customerLabel = row.recipient_name;
    if (!row.ticket_id) continue;
    ticketId = row.ticket_id;
    await query(
      `INSERT INTO public.ticket_messages (ticket_id, author_id, content, type, is_visible_to_customer)
       VALUES ($1, NULL, $2, 'system', false)`,
      [row.ticket_id, `A mensagem enviada por WhatsApp a ${row.recipient_name || 'o cliente'} não foi entregue: ${reason}`]
    );
    const t = await query('SELECT assignee_id FROM public.tickets WHERE id = $1', [row.ticket_id]);
    if (t.rows[0]?.assignee_id) notifyIds.add(t.rows[0].assignee_id);
  }

  if (!handled.length) return handled;

  // Só equipe é avisada — autor de nota/abertura pode ser um cliente.
  const ids = [...notifyIds];
  if (ids.length) {
    const staff = await query(
      'SELECT id FROM public.profiles WHERE id = ANY($1::uuid[]) AND role = ANY($2::text[])',
      [ids, TEAM_ROLES]
    );
    await Promise.all(staff.rows.map((u: { id: string }) =>
      notifyUser(u.id, {
        title: 'Mensagem não entregue no WhatsApp',
        body: `${customerLabel}: ${reason}`,
        url: ticketId ? `/tickets?ticket=${ticketId}` : '/chat-management',
        tag: `pyvon-delivery-${messageId}`
      }).catch(err => console.error('[pyvon-status] Falha ao enviar push:', err))
    ));
  }
  return handled;
}

export async function handleDeliveryStatus(payload: any, instanceId: string): Promise<{ status: DeliveryStatus; matched: boolean }> {
  const event = parseDeliveryStatusPayload(payload);

  let handled: string[] = [];
  if (event.status === 'failed') {
    if (event.messageId) {
      handled = await applyDeliveryFailure(event.messageId, event);
    } else {
      console.warn('[pyvon-status] Falha de entrega SEM message_id — gravada só em pyvon_delivery_events:', JSON.stringify(payload));
    }
  }

  await query(
    `INSERT INTO public.pyvon_delivery_events (instance_id, pyvon_message_id, cadastro_id, status, error_code, error_message, handled, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [instanceId, event.messageId, event.cadastroId, event.status, event.errorCode, event.errorMessage,
     handled.length ? [...new Set(handled)].join(',') : null, JSON.stringify(payload ?? null)]
  );

  return { status: event.status, matched: handled.length > 0 };
}
