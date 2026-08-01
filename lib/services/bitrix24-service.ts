import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { generateAvatarThumb } from '@/lib/services/avatar-thumb-service';

// Sincronização manual (botão "Sincronizar agora", sem job em segundo
// plano — decisão explícita) com o Bitrix24: empresas (CRM) para
// public.companies, e usuários internos (equipe do Bitrix24) para
// public.profiles. Autenticação via webhook de entrada do Bitrix24 (URL
// com o código do webhook embutido, não um "Bearer token" separado) — ver
// BITRIX24_WEBHOOK_URL na seção 4 do CLAUDE.md.

export class Bitrix24NotConfiguredError extends Error {}

function getBaseUrl(): string {
  const url = process.env.BITRIX24_WEBHOOK_URL;
  if (!url) {
    throw new Bitrix24NotConfiguredError('BITRIX24_WEBHOOK_URL não configurada — ver seção 4 do CLAUDE.md.');
  }
  return url.endsWith('/') ? url : `${url}/`;
}

export interface Bitrix24SyncResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// --- Empresas ----------------------------------------------------------------
// Casamento por NOME EXATO: se já existe empresa com o mesmo nome (TITLE no
// Bitrix), atualiza; senão cria. Não grava o ID do Bitrix em lugar nenhum —
// o casamento é sempre por nome, por decisão explícita (mais simples, sem
// migration nova).

interface BitrixPhone {
  VALUE?: string;
  VALUE_TYPE?: string;
}

interface BitrixCompany {
  ID: string;
  TITLE: string;
  INDUSTRY?: string | null;
  PHONE?: BitrixPhone[] | null;
}

async function fetchAllCompanies(): Promise<BitrixCompany[]> {
  const base = getBaseUrl();
  const all: BitrixCompany[] = [];
  let start = 0;

  while (true) {
    const params = new URLSearchParams({ start: String(start) });
    params.append('select[]', 'ID');
    params.append('select[]', 'TITLE');
    params.append('select[]', 'INDUSTRY');
    params.append('select[]', 'PHONE');

    const res = await fetch(`${base}crm.company.list.json?${params.toString()}`);
    if (!res.ok) throw new Error(`Bitrix24 respondeu ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.error) throw new Error(`Bitrix24: ${data.error_description || data.error}`);

    all.push(...(Array.isArray(data.result) ? data.result : []));

    if (typeof data.next === 'number') start = data.next;
    else break;
  }

  return all;
}

export async function syncCompaniesFromBitrix24(): Promise<Bitrix24SyncResult> {
  const companies = await fetchAllCompanies();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const c of companies) {
    const name = (c.TITLE || '').trim();
    if (!name) {
      skipped++;
      continue;
    }

    try {
      const phone = Array.isArray(c.PHONE) && c.PHONE.length > 0 ? (c.PHONE[0].VALUE || null) : null;
      const industry = c.INDUSTRY || null;

      const existing = await query('SELECT id FROM public.companies WHERE name = $1', [name]);
      if (existing.rows.length > 0) {
        await query(
          'UPDATE public.companies SET industry = $1, phone = $2 WHERE id = $3',
          [industry, phone, existing.rows[0].id]
        );
        updated++;
      } else {
        await query(
          'INSERT INTO public.companies (name, industry, phone) VALUES ($1, $2, $3)',
          [name, industry, phone]
        );
        created++;
      }
    } catch (err: any) {
      errors.push(`${name || c.ID}: ${err.message}`);
    }
  }

  return { fetched: companies.length, created, updated, skipped, errors };
}

// --- Usuários internos (equipe) -----------------------------------------------
// user.get devolve os USUÁRIOS DO BITRIX24 (quem usa o Bitrix na empresa),
// não contatos de CRM — é exatamente a "equipe" interna. Casamento por
// E-MAIL exato (profiles.email é UNIQUE) — atualiza nome/telefone/foto de
// quem já existe, cria como 'Equipe' quem não existe. Só salva o
// necessário: nome, e-mail, telefone, foto — nada de cargo/departamento/
// outros metadados do Bitrix.

interface BitrixUser {
  ID: string;
  NAME?: string;
  LAST_NAME?: string;
  EMAIL?: string;
  PERSONAL_MOBILE?: string;
  WORK_PHONE?: string;
  PERSONAL_PHOTO?: string;
  ACTIVE?: boolean;
}

async function fetchActiveUsers(): Promise<BitrixUser[]> {
  const base = getBaseUrl();
  const all: BitrixUser[] = [];
  let start = 0;

  while (true) {
    const params = new URLSearchParams({ start: String(start), 'filter[ACTIVE]': 'true' });
    const res = await fetch(`${base}user.get.json?${params.toString()}`);
    if (!res.ok) throw new Error(`Bitrix24 respondeu ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.error) throw new Error(`Bitrix24: ${data.error_description || data.error}`);

    all.push(...(Array.isArray(data.result) ? data.result : []));

    if (typeof data.next === 'number') start = data.next;
    else break;
  }

  return all;
}

const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3MB — cabelo de sobra pra uma foto de perfil, sem deixar a tabela inchar.

// Baixa a foto do Bitrix (URL pública do CDN deles) e converte pra data:
// URL — mesmo padrão que o resto do app já usa pra anexo/avatar (sem
// storage de arquivo dedicado). Falha em baixar não derruba a sincronização
// inteira, só aquele usuário fica sem foto atualizada.
async function downloadPhotoAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_PHOTO_BYTES) return null;

    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function getDefaultEquipeProfileId(): Promise<string | null> {
  const res = await query(
    `SELECT id FROM public.role_permissions WHERE role = 'Equipe' AND is_system = true LIMIT 1`
  );
  return res.rows[0]?.id || null;
}

export async function syncUsersFromBitrix24(): Promise<Bitrix24SyncResult> {
  const users = await fetchActiveUsers();
  const defaultProfileId = await getDefaultEquipeProfileId();
  const defaultPassword = hashPassword('Mudar@123'); // mesmo default de app/actions.ts#createUser

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const u of users) {
    const name = `${u.NAME || ''} ${u.LAST_NAME || ''}`.trim();
    const email = (u.EMAIL || '').trim().toLowerCase();
    if (!name || !email) {
      skipped++;
      continue;
    }

    try {
      const phone = u.PERSONAL_MOBILE || u.WORK_PHONE || null;
      const avatarDataUrl = u.PERSONAL_PHOTO ? await downloadPhotoAsDataUrl(u.PERSONAL_PHOTO) : null;
      // Só gera miniatura nova quando baixou foto nova — evita reprocessar
      // à toa quem já tinha avatar_thumb_url e não mudou de foto no Bitrix.
      const avatarThumbUrl = avatarDataUrl ? await generateAvatarThumb(avatarDataUrl) : null;

      const existing = await query('SELECT id FROM public.profiles WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        // COALESCE na foto: se o download falhou ou não tinha foto nova,
        // mantém a que já estava salva em vez de apagar (idem miniatura).
        await query(
          `UPDATE public.profiles SET name = $1, phone = $2, avatar_url = COALESCE($3, avatar_url), avatar_thumb_url = COALESCE($5, avatar_thumb_url) WHERE id = $4`,
          [name, phone, avatarDataUrl, existing.rows[0].id, avatarThumbUrl]
        );
        updated++;
      } else {
        await query(
          `INSERT INTO public.profiles (email, name, role, phone, avatar_url, avatar_thumb_url, password, is_admin, lives_in_squad, access_profile_id)
           VALUES ($1, $2, 'Equipe', $3, $4, $5, $6, false, true, $7)`,
          [email, name, phone, avatarDataUrl, avatarThumbUrl, defaultPassword, defaultProfileId]
        );
        created++;
      }
    } catch (err: any) {
      errors.push(`${name || email || u.ID}: ${err.message}`);
    }
  }

  return { fetched: users.length, created, updated, skipped, errors };
}
