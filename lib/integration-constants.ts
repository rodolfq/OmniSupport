// Constantes/tipos da API de integração que precisam ser importáveis tanto
// no servidor (rotas, lib/integration-auth.ts) quanto no cliente
// (components/integrations-content.tsx). Fica separado de
// lib/integration-auth.ts de propósito: aquele arquivo importa lib/db.ts
// (driver 'pg', Node-only) — importar qualquer coisa dele a partir de um
// client component quebra o bundle do navegador ("Module not found: fs").

export const INTEGRATION_SCOPES = [
  'employees:read',
  'employees:write',
  'tickets:read',
  'conversations:read',
] as const;

export type IntegrationScope = typeof INTEGRATION_SCOPES[number];

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 120;
