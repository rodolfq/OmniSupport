import { query } from '@/lib/db';

// Sincronização manual (botão "Sincronizar agora", sem job em segundo
// plano — decisão explícita) de empresas do Bitrix24 (CRM) para
// public.companies. Autenticação via webhook de entrada do Bitrix24 (URL
// com o código do webhook embutido, não um "Bearer token" separado) — ver
// BITRIX24_WEBHOOK_URL na seção 4 do CLAUDE.md.
//
// Casamento por NOME EXATO: se já existe uma empresa com o mesmo nome
// (TITLE no Bitrix), atualiza os dados dela; senão, cria uma nova. Não
// grava o ID do Bitrix em lugar nenhum — o casamento é sempre por nome,
// por decisão explícita (mais simples, sem migration nova).

export class Bitrix24NotConfiguredError extends Error {}

function getBaseUrl(): string {
  const url = process.env.BITRIX24_WEBHOOK_URL;
  if (!url) {
    throw new Bitrix24NotConfiguredError('BITRIX24_WEBHOOK_URL não configurada — ver seção 4 do CLAUDE.md.');
  }
  return url.endsWith('/') ? url : `${url}/`;
}

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

// Métodos *.list do Bitrix24 paginam em blocos de 50 — `next` no corpo da
// resposta indica o próximo `start`; ausência de `next` significa que
// chegou na última página.
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
    if (!res.ok) {
      throw new Error(`Bitrix24 respondeu ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (data.error) {
      throw new Error(`Bitrix24: ${data.error_description || data.error}`);
    }

    all.push(...(Array.isArray(data.result) ? data.result : []));

    if (typeof data.next === 'number') {
      start = data.next;
    } else {
      break;
    }
  }

  return all;
}

export interface Bitrix24SyncResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
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
