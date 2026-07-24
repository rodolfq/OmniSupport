import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { handleTicketCreated, handleTicketUpdated, handleTicketMessageCreated } from '@/lib/services/automation-service';

// Versão independente (params próprios, sempre a partir de $1) da mesma
// lógica de filtros usada por buildWhereClause() dentro do POST — usada só
// para o pré-SELECT do estado "antigo" do chamado antes de um UPDATE em
// `tickets`, sem interferir no array de params/paramIndex compartilhado
// que o restante da rota genérica usa.
function buildStandaloneWhereClause(table: string, filters: any[] | undefined): { clause: string; params: any[] } {
  const params: any[] = [];
  let paramIndex = 1;
  if (!filters || filters.length === 0) return { clause: '', params };
  const clauses: string[] = [];
  for (const filter of filters) {
    if (filter.type === 'offset') continue;
    if (filter.type === 'eq') {
      if (table === 'profiles' && filter.col === 'phone') {
        clauses.push(`(phone = $${paramIndex} OR phone = $${paramIndex + 1} OR phone = $${paramIndex + 2})`);
        params.push(filter.val, `+${filter.val}`, `55${filter.val}`);
        paramIndex += 3;
      } else {
        clauses.push(`${filter.col} = $${paramIndex}`);
        params.push(filter.val);
        paramIndex++;
      }
    } else if (filter.type === 'neq') {
      clauses.push(`${filter.col} != $${paramIndex}`);
      params.push(filter.val);
      paramIndex++;
    } else if (filter.type === 'in') {
      const placeholders = filter.val.map((_: any, idx: number) => `$${paramIndex + idx}`).join(',');
      clauses.push(`${filter.col} IN (${placeholders})`);
      params.push(...filter.val);
      paramIndex += filter.val.length;
    } else if (filter.type === 'or') {
      const parts = filter.val.split(',');
      const orClauses: string[] = [];
      for (const part of parts) {
        const subparts = part.split('.');
        if (subparts.length >= 3) {
          const col = subparts[0];
          const op = subparts[1];
          const val = subparts.slice(2).join('.');
          if (op === 'eq') {
            orClauses.push(`${col} = $${paramIndex}`);
            params.push(val);
            paramIndex++;
          }
        }
      }
      if (orClauses.length > 0) clauses.push(`(${orClauses.join(' OR ')})`);
    } else if (filter.type === 'not') {
      if (filter.operator === 'is' && filter.val === null) {
        clauses.push(`${filter.col} IS NOT NULL`);
      } else if (filter.operator === 'in') {
        const items = String(filter.val)
          .replace(/^\(|\)$/g, '')
          .split(',')
          .map((s: string) => s.trim().replace(/^"(.*)"$/, '$1'))
          .filter((s: string) => s.length > 0);
        if (items.length > 0) {
          const placeholders = items.map((_: any, idx: number) => `$${paramIndex + idx}`).join(',');
          clauses.push(`${filter.col} NOT IN (${placeholders})`);
          params.push(...items);
          paramIndex += items.length;
        }
      }
    } else if (filter.type === 'gt') {
      clauses.push(`${filter.col} > $${paramIndex}`);
      params.push(filter.val);
      paramIndex++;
    } else if (filter.type === 'gte') {
      clauses.push(`${filter.col} >= $${paramIndex}`);
      params.push(filter.val);
      paramIndex++;
    } else if (filter.type === 'lt') {
      clauses.push(`${filter.col} < $${paramIndex}`);
      params.push(filter.val);
      paramIndex++;
    } else if (filter.type === 'lte') {
      clauses.push(`${filter.col} <= $${paramIndex}`);
      params.push(filter.val);
      paramIndex++;
    } else if (filter.type === 'ilike') {
      clauses.push(`${filter.col} ILIKE $${paramIndex}`);
      params.push(filter.val);
      paramIndex++;
    }
  }
  return { clause: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

// Colunas que são arrays nativos do Postgres (ex: text[], uuid[]) precisam ser
// passadas como array JS puro para o driver `pg` serializar no formato "{a,b,c}".
// Colunas jsonb que guardam listas (ex: attachments_data) precisam do texto JSON
// "[...]" via JSON.stringify. Sem essa distinção, um array vazio em uma coluna
// array nativa (ex: tags TEXT[]) vira a string "[]" e o Postgres rejeita com
// "malformed array literal". Cache simples em memória por tabela.
const arrayColumnsCache = new Map<string, Set<string>>();

async function getNativeArrayColumns(table: string): Promise<Set<string>> {
  if (arrayColumnsCache.has(table)) return arrayColumnsCache.get(table)!;
  const res = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'ARRAY'`,
    [table]
  );
  const cols = new Set(res.rows.map((r: any) => r.column_name as string));
  arrayColumnsCache.set(table, cols);
  return cols;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      table,
      action,
      payload,
      filters,
      orderBy,
      limitCount,
      isSingle,
      isMaybeSingle,
      wantCount
    } = body;

    let sql = '';
    const params: any[] = [];
    let paramIndex = 1;

    // Helper to build SQL WHERE clauses
    const buildWhereClause = () => {
      if (!filters || filters.length === 0) return '';
      const clauses: string[] = [];
      for (const filter of filters) {
        if (filter.type === 'offset') {
          continue; // Pula do WHERE, processado na paginação
        }
        if (filter.type === 'eq') {
          if (table === 'profiles' && filter.col === 'phone') {
            clauses.push(`(phone = $${paramIndex} OR phone = $${paramIndex + 1} OR phone = $${paramIndex + 2})`);
            params.push(filter.val, `+${filter.val}`, `55${filter.val}`);
            paramIndex += 3;
          } else {
            clauses.push(`${filter.col} = $${paramIndex}`);
            params.push(filter.val);
            paramIndex++;
          }
        } else if (filter.type === 'neq') {
          clauses.push(`${filter.col} != $${paramIndex}`);
          params.push(filter.val);
          paramIndex++;
        } else if (filter.type === 'in') {
          const placeholders = filter.val.map((_: any, idx: number) => `$${paramIndex + idx}`).join(',');
          clauses.push(`${filter.col} IN (${placeholders})`);
          params.push(...filter.val);
          paramIndex += filter.val.length;
        } else if (filter.type === 'or') {
          const parts = filter.val.split(',');
          const orClauses: string[] = [];
          for (const part of parts) {
            const subparts = part.split('.');
            if (subparts.length >= 3) {
              const col = subparts[0];
              const op = subparts[1];
              const val = subparts.slice(2).join('.');
              if (op === 'eq') {
                orClauses.push(`${col} = $${paramIndex}`);
                params.push(val);
                paramIndex++;
              }
            }
          }
          if (orClauses.length > 0) {
            clauses.push(`(${orClauses.join(' OR ')})`);
          }
        } else if (filter.type === 'not') {
          if (filter.operator === 'is' && filter.val === null) {
            clauses.push(`${filter.col} IS NOT NULL`);
          } else if (filter.operator === 'in') {
            // Formato estilo PostgREST: "(\"a\",\"b\")" -> lista de valores
            const items = String(filter.val)
              .replace(/^\(|\)$/g, '')
              .split(',')
              .map((s: string) => s.trim().replace(/^"(.*)"$/, '$1'))
              .filter((s: string) => s.length > 0);
            if (items.length > 0) {
              const placeholders = items.map((_: any, idx: number) => `$${paramIndex + idx}`).join(',');
              clauses.push(`${filter.col} NOT IN (${placeholders})`);
              params.push(...items);
              paramIndex += items.length;
            }
          }
        } else if (filter.type === 'gt') {
          clauses.push(`${filter.col} > $${paramIndex}`);
          params.push(filter.val);
          paramIndex++;
        } else if (filter.type === 'gte') {
          clauses.push(`${filter.col} >= $${paramIndex}`);
          params.push(filter.val);
          paramIndex++;
        } else if (filter.type === 'lt') {
          clauses.push(`${filter.col} < $${paramIndex}`);
          params.push(filter.val);
          paramIndex++;
        } else if (filter.type === 'lte') {
          clauses.push(`${filter.col} <= $${paramIndex}`);
          params.push(filter.val);
          paramIndex++;
        } else if (filter.type === 'ilike') {
          clauses.push(`${filter.col} ILIKE $${paramIndex}`);
          params.push(filter.val);
          paramIndex++;
        }
      }
      return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    };

    if (action === 'select') {
      // Guardado à parte (não só inline) pra poder reaproveitar a mesma
      // cláusula/params numa segunda query de COUNT(*) quando wantCount for
      // pedido — sem LIMIT/OFFSET, que são interpolados direto na sql
      // principal, não entram nesses params.
      const whereClause = buildWhereClause();
      sql = `SELECT * FROM public.${table}`;
      sql += whereClause;

      if (orderBy && orderBy.col) {
        sql += ` ORDER BY ${orderBy.col} ${orderBy.ascending ? 'ASC' : 'DESC'}`;
      }

      if (typeof limitCount === 'number') {
        sql += ` LIMIT ${limitCount}`;
      }

      let offsetCount = null;
      if (filters) {
        const offsetFilter = filters.find((f: any) => f.type === 'offset');
        if (offsetFilter) {
          offsetCount = offsetFilter.val;
        }
      }
      if (typeof offsetCount === 'number') {
        sql += ` OFFSET ${offsetCount}`;
      }

      const res = await query(sql, params);

      // wantCount é opt-in (só quem chama .select('*', { count: 'exact' })
      // manda essa flag) — por isso a resposta só muda de formato (objeto
      // com rows/count em vez do array cru) nesse caso específico, sem
      // afetar quem já espera o formato antigo.
      if (wantCount) {
        const countRes = await query(`SELECT COUNT(*)::int AS count FROM public.${table}${whereClause}`, params);
        return NextResponse.json({ rows: res.rows, count: countRes.rows[0]?.count ?? 0 });
      }

      if (isSingle || isMaybeSingle) {
        return NextResponse.json(res.rows[0] || null);
      }
      return NextResponse.json(res.rows);
    }

    if (action === 'insert' || action === 'upsert') {
      const records = Array.isArray(payload) ? payload : [payload];
      if (records.length === 0) return NextResponse.json([]);

      const nativeArrayColumns = await getNativeArrayColumns(table);
      const returned: any[] = [];
      for (const record of records) {
        const columns = Object.keys(record);
        const placeholders = columns.map((_, i) => `$${paramIndex + i}`).join(',');
        const recordParams = columns.map(col => {
          let val = record[col];
          if (val === '') {
            if (col === 'id' || col.endsWith('_id')) {
              val = null;
            }
          }
          if (Array.isArray(val) && nativeArrayColumns.has(col)) {
            return val;
          }
          if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
            return JSON.stringify(val);
          }
          return val;
        });

        let upsertClause = '';
        if (action === 'upsert') {
          const updateAssignments = columns.map(col => `${col} = EXCLUDED.${col}`).join(', ');
          upsertClause = ` ON CONFLICT (id) DO UPDATE SET ${updateAssignments}`;
        }

        const insertSql = `
          INSERT INTO public.${table} (${columns.join(', ')})
          VALUES (${placeholders})
          ${upsertClause}
          RETURNING *
        `;

        const res = await query(insertSql, recordParams);
        returned.push(res.rows[0]);
      }

      if (table === 'tickets') {
        for (const row of returned) {
          if (row) handleTicketCreated(row);
        }
      } else if (table === 'ticket_messages') {
        for (const row of returned) {
          if (row && row.is_visible_to_customer && row.type !== 'internal') {
            query('SELECT * FROM public.tickets WHERE id = $1', [row.ticket_id])
              .then(r => handleTicketMessageCreated(row, r.rows[0]))
              .catch(err => console.error('[automation] Falha ao buscar chamado (compat insert):', err));
          }
        }
      }

      if (isSingle || isMaybeSingle) {
        return NextResponse.json(returned[0] || null);
      }
      return NextResponse.json(Array.isArray(payload) ? returned : returned[0]);
    }

    if (action === 'update') {
      const columns = Object.keys(payload);
      if (columns.length === 0) return NextResponse.json([]);

      const nativeArrayColumns = await getNativeArrayColumns(table);
      const setAssignments = columns.map((col, idx) => `${col} = $${paramIndex + idx}`).join(', ');
      const updateParams = columns.map(col => {
        let val = payload[col];
        if (val === '') {
          if (col === 'id' || col.endsWith('_id')) {
            val = null;
          }
        }
        if (Array.isArray(val) && nativeArrayColumns.has(col)) {
          return val;
        }
        if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
          return JSON.stringify(val);
        }
        return val;
      });

      params.unshift(...updateParams); // Put updates first in params array
      paramIndex += columns.length;

      // Estado "antigo" precisa ser lido ANTES do UPDATE (rota genérica, não
      // dá pra saber que é um chamado sem isso) para os hooks de automação
      // conseguirem comparar o que mudou.
      let oldTicketsById: Map<string, any> | null = null;
      if (table === 'tickets') {
        const { clause, params: whereParams } = buildStandaloneWhereClause(table, filters);
        const oldRes = await query(`SELECT * FROM public.tickets${clause}`, whereParams);
        oldTicketsById = new Map(oldRes.rows.map((r: any) => [r.id, r]));
      }

      sql = `UPDATE public.${table} SET ${setAssignments}`;
      sql += buildWhereClause();
      sql += ' RETURNING *';

      const res = await query(sql, params);

      if (table === 'tickets' && oldTicketsById) {
        for (const newTicket of res.rows) {
          handleTicketUpdated(oldTicketsById.get(newTicket.id), newTicket);
        }
      }

      if (isSingle || isMaybeSingle) {
        return NextResponse.json(res.rows[0] || null);
      }
      return NextResponse.json(res.rows);
    }

    if (action === 'delete') {
      sql = `DELETE FROM public.${table}`;
      sql += buildWhereClause();
      sql += ' RETURNING *';

      const res = await query(sql, params);
      return NextResponse.json(res.rows);
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in Supabase compatibility route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
