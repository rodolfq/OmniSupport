// Texto fixo do Modo de Crise — vive à parte de lib/services/crisis-mode-
// service.ts (que puxa lib/db e lib/chat-events, server-only) só para poder
// ser importado também pela tela de Configurações ('use client'), que
// mostra o texto como referência (não é editável por lá).
export const CRISIS_MODE_MESSAGE = `Olá! tudo bem?

Nosso sistema está passando por instabilidades nesse momento. Estamos nos esforçando para resolver com urgência.

Qualquer outra dúvida nesse meio tempo, pode nos enviar por aqui.`;
