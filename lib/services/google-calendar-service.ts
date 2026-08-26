import { query } from '../db';

/**
 * Integração com Google Agenda — vínculo pessoal por usuário (OAuth2, só
 * leitura: escopo `calendar.readonly`, decisão do time — ver CLAUDE.md seção
 * 10). Cada pessoa conecta a própria conta; não existe "conta compartilhada".
 *
 * Fluxo: app/api/integrations/google-calendar/route.ts (?action=connect)
 * manda o navegador pro Google; o Google devolve pro callback
 * (app/api/integrations/google-calendar/callback/route.ts), que troca o
 * `code` pelos tokens aqui. O `refresh_token` é o que importa de verdade —
 * não expira sozinho, é ele que permite buscar eventos sem a pessoa logar de
 * novo. O `access_token` é só um cache de curta duração por cima dele.
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// openid+email só para mostrar "conectado como fulano@gmail.com" na tela —
// nunca usado pra autenticação (a sessão do SSX Desk continua sendo o cookie
// JWT próprio, ver lib/jwt.ts). calendar.readonly é o único escopo que
// importa de verdade pro recurso em si.
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'];

export class GoogleCalendarNotConfiguredError extends Error {}

function getClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new GoogleCalendarNotConfiguredError('GOOGLE_CLIENT_ID não configurado — ver seção 4 do CLAUDE.md.');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new GoogleCalendarNotConfiguredError('GOOGLE_CLIENT_SECRET não configurado — ver seção 4 do CLAUDE.md.');
  return secret;
}

/**
 * URL de callback registrada no Google Cloud Console. Sem `GOOGLE_REDIRECT_URI`
 * explícita, deriva da própria requisição (cobre o caso comum, um domínio só,
 * sem exigir configuração) — mesma filosofia de `API_BASE_URL` em
 * lib/runtime-config.ts: vazio preserva o comportamento automático, definido
 * assume o controle explícito (necessário se front/back estiverem em domínios
 * diferentes, onde o valor "adivinhado" pela requisição pode não ser o
 * publicamente correto).
 */
export function resolveRedirectUri(requestUrl: string): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI;
  if (explicit) return explicit;
  return new URL('/api/integrations/google-calendar/callback', requestUrl).toString();
}

export function buildAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // offline + consent: sem os dois juntos o Google só manda refresh_token
    // na PRIMEIRA autorização de todas — se a pessoa desvincular e vincular
    // de novo depois, o segundo vínculo viria sem refresh_token nenhum.
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

async function exchangeCode(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `Google respondeu ${res.status}`);
  return data;
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `Google respondeu ${res.status}`);
  return data;
}

/** E-mail extraído do id_token (JWT), só para exibição — a assinatura não é
 * conferida de propósito, já que o valor nunca autoriza nada por si só. */
function decodeEmailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1];
    const json = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(json).email || null;
  } catch {
    return null;
  }
}

export async function connectGoogleCalendar(userId: string, code: string, redirectUri: string): Promise<void> {
  const tokens = await exchangeCode(code, redirectUri);
  if (!tokens.refresh_token) {
    // Não deveria acontecer com access_type=offline&prompt=consent — mas se
    // a pessoa negar o consentimento de acesso contínuo na tela do Google,
    // é isso que volta.
    throw new Error('O Google não concedeu acesso contínuo à agenda. Tente vincular de novo.');
  }
  const email = decodeEmailFromIdToken(tokens.id_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await query(
    `INSERT INTO public.google_calendar_connections (user_id, google_email, refresh_token, access_token, access_token_expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       google_email = EXCLUDED.google_email,
       refresh_token = EXCLUDED.refresh_token,
       access_token = EXCLUDED.access_token,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       updated_at = now()`,
    [userId, email, tokens.refresh_token, tokens.access_token, expiresAt]
  );
}

export interface GoogleCalendarStatus {
  connected: boolean;
  email: string | null;
}

export async function getConnectionStatus(userId: string): Promise<GoogleCalendarStatus> {
  const res = await query('SELECT google_email FROM public.google_calendar_connections WHERE user_id = $1', [userId]);
  if (!res.rows[0]) return { connected: false, email: null };
  return { connected: true, email: res.rows[0].google_email };
}

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  const res = await query('SELECT refresh_token FROM public.google_calendar_connections WHERE user_id = $1', [userId]);
  const token = res.rows[0]?.refresh_token;
  await query('DELETE FROM public.google_calendar_connections WHERE user_id = $1', [userId]);
  if (token) {
    // Revogação é melhor-esforço: a conexão já saiu do nosso lado de
    // qualquer forma, então uma falha aqui não pode virar erro pro usuário.
    fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  }
}

/** Access token válido pra chamar a API do Google — renova sozinho quando
 * está a menos de 1 minuto de expirar, e persiste o novo token. */
async function getValidAccessToken(userId: string): Promise<string | null> {
  const res = await query(
    'SELECT refresh_token, access_token, access_token_expires_at FROM public.google_calendar_connections WHERE user_id = $1',
    [userId]
  );
  const row = res.rows[0];
  if (!row) return null;

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (row.access_token && expiresAt - Date.now() > 60_000) {
    return row.access_token;
  }

  const tokens = await refreshAccessToken(row.refresh_token);
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await query(
    `UPDATE public.google_calendar_connections SET access_token = $1, access_token_expires_at = $2, updated_at = now() WHERE user_id = $3`,
    [tokens.access_token, newExpiresAt, userId]
  );
  return tokens.access_token;
}

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  start: string; // ISO
  url: string | null;
}

/**
 * Eventos COM horário marcado (nunca de dia inteiro — não faz sentido avisar
 * "X minutos antes" de um evento sem hora) começando entre agora e
 * `windowMinutes` minutos à frente.
 */
export async function listUpcomingEvents(userId: string, windowMinutes: number): Promise<GoogleCalendarEvent[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return [];

  const now = new Date();
  const timeMax = new Date(now.getTime() + windowMinutes * 60_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '20'
  });

  const res = await fetch(`${CALENDAR_EVENTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (res.status === 401) {
    // Acesso revogado do lado do Google (a pessoa removeu o SSX Desk na
    // própria conta) — não é um erro do scheduler, é "essa pessoa não está
    // mais conectada de verdade". Silencioso, mesmo espírito de
    // skipTurnForTicketClaim em giro-service.ts.
    return [];
  }
  if (!res.ok) throw new Error(`Google Agenda respondeu ${res.status}`);

  const data = await res.json();
  const items: any[] = data.items || [];
  return items
    .filter(item => !!item.start?.dateTime)
    .map(item => ({
      id: item.id,
      title: item.summary || 'Sem título',
      start: item.start.dateTime,
      url: item.hangoutLink || item.htmlLink || null
    }));
}

export async function listConnectedUserIds(): Promise<string[]> {
  const res = await query('SELECT user_id FROM public.google_calendar_connections');
  return res.rows.map((r: any) => r.user_id as string);
}
