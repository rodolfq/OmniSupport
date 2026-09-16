// Texto fixo do Modo de Crise — vive à parte de lib/services/crisis-mode-
// service.ts (que puxa lib/db e lib/chat-events, server-only) só para poder
// ser importado também pela tela de Configurações ('use client'), que
// mostra o texto como referência (não é editável por lá).
export const CRISIS_MODE_MESSAGE = `Olá! Tudo bem?

Nosso sistema está passando por instabilidades nesse momento. Nosso time está focado na solução o quanto antes.

Qualquer outra dúvida nesse meio tempo, pode nos enviar por aqui.`;
