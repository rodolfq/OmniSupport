import { query } from '@/lib/db';
import { emitChatEvent, emitSessionsChanged } from '@/lib/chat-events';
import { CRISIS_MODE_MESSAGE } from '@/lib/crisis-mode-message';

export { CRISIS_MODE_MESSAGE };

// Modo de Crise: liga/desliga e mensagem em Configurações > Sistema
// (Administrador), linha única em config_crisis_mode. Enquanto ligado, toda
// sessão de chat NOVA — em qualquer canal (Baileys, Pyvon, widget do portal)
// — recebe este aviso automaticamente assim que nasce/cai na fila, além da
// atribuição normal ao próximo analista do rodízio.

export async function isCrisisModeEnabled(): Promise<boolean> {
  const res = await query('SELECT enabled FROM public.config_crisis_mode WHERE id = 1');
  return !!res.rows[0]?.enabled;
}

// message em branco/NULL (nunca configurado, ou apagado de propósito) cai no
// texto padrão — nunca manda mensagem vazia pro cliente. Buscado uma vez por
// disparo (não em recordCrisisModeMessage) pra quem chama poder usar o MESMO
// texto tanto no envio real (WhatsApp/Pyvon) quanto no registro do histórico.
export async function getCrisisModeMessage(): Promise<string> {
  const res = await query('SELECT message FROM public.config_crisis_mode WHERE id = 1');
  const custom = res.rows[0]?.message;
  return custom && custom.trim() ? custom : CRISIS_MODE_MESSAGE;
}

// Só a parte comum a qualquer canal: grava a mensagem no histórico da
// conversa (visível ao analista) e avisa quem estiver com a tela aberta via
// SSE. O envio de verdade pelo provedor (WhatsApp/Pyvon) é feito por quem
// chama esta função, ANTES — cada canal já tem seu próprio jeito de mandar
// texto pro cliente (WhatsAppService/PyvonService); o widget não precisa de
// nenhum envio externo, só isso aqui já é suficiente pro cliente ver a
// mensagem.
//
// `message` opcional: quem já buscou o texto pra mandar pelo canal externo
// (WhatsApp/Pyvon, ver getCrisisModeMessage) passa o MESMO valor aqui, pra
// não buscar duas vezes nem arriscar gravar um texto diferente do que foi
// realmente enviado (ex.: alguém troca a mensagem no meio do disparo). Quem
// não manda nada fora daqui (widget) deixa em branco e esta função busca.
export async function recordCrisisModeMessage(sessionId: string, message?: string): Promise<void> {
  const text = message ?? await getCrisisModeMessage();
  const metadata = { source: 'crisis_mode', auto_reply: true };
  const messageRes = await query(
    `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, created_at)
     VALUES ($1, NULL, $2, $3, 'text', $4, NOW())
     RETURNING id, created_at`,
    [sessionId, 'SSX Desk (automático)', text, JSON.stringify(metadata)]
  );
  const savedMessage = messageRes.rows[0];
  if (!savedMessage) return;

  await query('UPDATE public.chat_sessions SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1', [sessionId]);

  emitSessionsChanged({ reason: 'message', sessionId });
  emitChatEvent(sessionId, {
    type: 'message',
    sessionId,
    message: {
      id: savedMessage.id,
      senderId: null,
      senderName: 'SSX Desk (automático)',
      text,
      timestamp: savedMessage.created_at,
      type: 'text',
      metadata,
      attachments: []
    }
  });
}
