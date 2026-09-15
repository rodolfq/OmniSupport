import { query } from '@/lib/db';
import { emitChatEvent, emitSessionsChanged } from '@/lib/chat-events';
import { CRISIS_MODE_MESSAGE } from '@/lib/crisis-mode-message';

export { CRISIS_MODE_MESSAGE };

// Modo de Crise: liga/desliga em Configurações > Sistema (Administrador),
// linha única em config_crisis_mode. Enquanto ligado, toda sessão de chat
// NOVA — em qualquer canal (Baileys, Meta, Pyvon, widget do portal) — recebe
// este aviso automaticamente assim que nasce/cai na fila, além da atribuição
// normal ao próximo analista do rodízio. Texto fixo, não editável pela tela.

export async function isCrisisModeEnabled(): Promise<boolean> {
  const res = await query('SELECT enabled FROM public.config_crisis_mode WHERE id = 1');
  return !!res.rows[0]?.enabled;
}

// Só a parte comum a qualquer canal: grava a mensagem no histórico da
// conversa (visível ao analista) e avisa quem estiver com a tela aberta via
// SSE. O envio de verdade pelo provedor (WhatsApp/Pyvon) é feito por quem
// chama esta função, ANTES — cada canal já tem seu próprio jeito de mandar
// texto pro cliente (WhatsAppService/MetaWhatsAppService/PyvonService); o
// widget não precisa de nenhum envio externo, só isso aqui já é suficiente
// pro cliente ver a mensagem.
export async function recordCrisisModeMessage(sessionId: string): Promise<void> {
  const metadata = { source: 'crisis_mode', auto_reply: true };
  const messageRes = await query(
    `INSERT INTO public.chat_messages (session_id, sender_id, sender_name, text, type, metadata, created_at)
     VALUES ($1, NULL, $2, $3, 'text', $4, NOW())
     RETURNING id, created_at`,
    [sessionId, 'SSX Desk (automático)', CRISIS_MODE_MESSAGE, JSON.stringify(metadata)]
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
      text: CRISIS_MODE_MESSAGE,
      timestamp: savedMessage.created_at,
      type: 'text',
      metadata,
      attachments: []
    }
  });
}
