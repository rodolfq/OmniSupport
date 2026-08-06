import React from 'react';
import { cn } from '@/lib/utils';

const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
// Número de telefone solto no texto — DDD + corpo de 8 dígitos (fixo) ou
// 9 dígitos (celular, "9" opcional aqui), com/sem +55 na frente, com/sem
// separador (espaço, hífen, parênteses), com/sem "0" de tronco antes do DDD
// (convenção antiga de discagem — nenhum DDD de verdade começa com 0, então
// o "0" aqui só pode ser esse prefixo, nunca parte do DDD) e tolerando até
// 2 dígitos redundantes logo depois do "55" (alguém cola um número que já
// tem DDI e ainda sobra um DDD/prefixo repetido na frente, ex.:
// "551121991778567"). Normalização de verdade (decidir quais dígitos
// descartar) fica em normalizeBrazilianPhoneDigits (lib/utils.ts) — aqui é
// só reconhecer que aquilo É um telefone. Cobre "11999999999",
// "11 9 9999-9999", "(11) 99999-9999", "+55 11 99999-9999",
// "021991778567", "(021) 99177-8567", "551121991778567" etc — mesma ideia
// solta (com falsos positivos aceitáveis) que o WhatsApp Web usa pra virar
// número em algo clicável dentro da mensagem. Lookaround em vez de \b nas
// pontas: \b não separa dígito de dígito, então sem isso um trecho de 15
// dígitos seguidos casava só uma fatia de 10/11 no meio.
const PHONE_PATTERN = /(?<!\d)((?:\+?55[\s.-]?)?(?:\d{2}[\s.-]?)?\(?0?\d{2}\)?[\s.-]?9?[\s.-]?\d{4}[\s.-]?\d{4})(?!\d)/g;

// Extraído de components/chat-widget.tsx pra ser reaproveitado em qualquer
// lugar que mostre texto de mensagem de WhatsApp/widget fora do próprio
// ChatWidget (ver app/(portal)/chat-management/page.tsx, preview de
// conversa na fila) — sem isso, cada tela que lê `message.text` cru tinha
// que reimplementar link de URL e telefone na mão.
export function renderLinkedText(text: string, isOwnMessage: boolean, onPhoneClick?: (phone: string) => void) {
  const linkClassName = cn(
    "font-black underline underline-offset-4 break-all",
    isOwnMessage ? "text-white decoration-white/70" : "text-[var(--accent-text)] decoration-[var(--accent)]"
  );

  return text.split(URL_PATTERN).map((part, index) => {
    if (part.match(URL_PATTERN)) {
      const href = part.startsWith('http') ? part : `https://${part}`;
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className={linkClassName}
        >
          {part}
        </a>
      );
    }

    if (!onPhoneClick) return <React.Fragment key={index}>{part}</React.Fragment>;

    // Fora dos trechos que já são URL, ainda procura número de telefone
    // solto (ex.: "me liga no 11999999999") — clicável, abre/retoma a
    // conversa com esse número.
    return (
      <React.Fragment key={index}>
        {part.split(PHONE_PATTERN).map((sub, subIndex) => {
          if (!sub) return null;
          if (sub.match(PHONE_PATTERN)) {
            return (
              <button
                key={subIndex}
                type="button"
                onClick={(event) => { event.stopPropagation(); onPhoneClick(sub); }}
                className={linkClassName}
                title="Abrir conversa com este número"
              >
                {sub}
              </button>
            );
          }
          return <React.Fragment key={subIndex}>{sub}</React.Fragment>;
        })}
      </React.Fragment>
    );
  });
}
