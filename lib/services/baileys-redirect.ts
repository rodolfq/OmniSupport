import { runExclusive } from '../key-mutex';

// Aviso enviado a TODO contato que escreve pelo WhatsApp não oficial (QR Code /
// Baileys) e não tem uma conversa em atendimento com um analista: o cliente é
// empurrado pro número novo, que é o do Pyvon (decisão do usuário,
// 2026-09-24). Nesse caso NÃO nasce conversa nem a mensagem é gravada — o
// aviso é a única coisa que acontece (ver processIncomingMessage em
// whatsapp-service.ts). Mesmo texto do Modo de Crise, mas fixo aqui: o Modo de
// Crise liga/desliga e pode ter o texto editado, este aviso não.
export const BAILEYS_REDIRECT_MESSAGE = `👋 *Bem-vindo ao Suporte Systemsat!*

Estamos preparando uma *nova experiência de atendimento para você*.

Conheça o *SSX Desk*, nosso novo ambiente para abrir e acompanhar seus chamados e falar diretamente com nossa equipe.

📲 *Mais proximidade, agilidade e facilidade.*

Cadastre seu e-mail no SSX Desk e aproveite também nosso *novo WhatsApp do Suporte*:

📱 *+1 (555) 300-3036*

*Estamos aqui para atender você cada vez melhor. 💙*`;

// Mesmo contato escrevendo de novo: o aviso volta a sair, mas no máximo uma vez
// a cada 5 minutos — só pra não virar spam.
export const BAILEYS_REDIRECT_INTERVAL_SECONDS = 5 * 60;

// Última TENTATIVA por contato, neste processo — inclusive as que falharam. Sem
// conversa, não há onde registrar o envio no banco, então a trava é só em
// memória: um reinício do servidor zera e o contato pode receber o aviso mais
// uma vez dentro da janela (custo aceito). Contar também a tentativa que falhou
// importa porque sendMessage (whatsapp-service.ts) derruba a instância da
// memória a cada falha de envio; sem isso, um contato cujo envio falha sempre
// dispararia uma tentativa nova a cada mensagem e mexeria na conexão de todo
// mundo.
const lastAttemptAt = new Map<string, number>();
const MAX_TRACKED_CONTACTS = 5000;

function pruneAttempts(now: number) {
  if (lastAttemptAt.size < MAX_TRACKED_CONTACTS) return;
  for (const [key, at] of lastAttemptAt) {
    if (now - at > BAILEYS_REDIRECT_INTERVAL_SECONDS * 1000) lastAttemptAt.delete(key);
  }
}

/**
 * Envia o aviso se este contato ainda não recebeu nos últimos 5 minutos.
 * Devolve true só quando o envio foi feito. Nunca lança: o aviso é um extra e
 * não pode atrapalhar o recebimento das outras mensagens.
 */
export async function sendBaileysRedirectNoticeIfDue(params: {
  contactKey: string;
  send: (text: string) => Promise<void>;
}): Promise<boolean> {
  const { contactKey, send } = params;

  try {
    // Uma mensagem por vez por contato: o cliente costuma mandar várias
    // seguidas ("Boa tarde" x3 no mesmo segundo) e todas passariam pela
    // checagem antes de a primeira registrar a tentativa.
    return await runExclusive(`baileys-redirect:${contactKey}`, async () => {
      const now = Date.now();
      const last = lastAttemptAt.get(contactKey);
      if (last !== undefined && now - last < BAILEYS_REDIRECT_INTERVAL_SECONDS * 1000) return false;

      // Marca a tentativa ANTES de enviar: se o envio falhar, a próxima só sai
      // depois do intervalo.
      lastAttemptAt.set(contactKey, now);
      pruneAttempts(now);

      await send(BAILEYS_REDIRECT_MESSAGE);
      return true;
    });
  } catch (err: any) {
    console.error('[WhatsApp] Falha ao enviar o aviso de redirecionamento:', err?.message || err);
    return false;
  }
}
