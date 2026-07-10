import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

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
      isMaybeSingle
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
        }
      }
      return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    };

    if (action === 'select') {
      sql = `SELECT * FROM public.${table}`;
      sql += buildWhereClause();

      if (orderBy) {
        sql += ` ORDER BY ${orderBy.col} ${orderBy.ascending ? 'ASC' : 'DESC'}`;
      }

      if (limitCount !== null) {
        sql += ` LIMIT ${limitCount}`;
      }

      let offsetCount = null;
      if (filters) {
        const offsetFilter = filters.find((f: any) => f.type === 'offset');
        if (offsetFilter) {
          offsetCount = offsetFilter.val;
        }
      }
      if (offsetCount !== null) {
        sql += ` OFFSET ${offsetCount}`;
      }

      const res = await query(sql, params);
      
      if (isSingle || isMaybeSingle) {
        return NextResponse.json(res.rows[0] || null);
      }
      return NextResponse.json(res.rows);
    }

    if (action === 'insert' || action === 'upsert') {
      const records = Array.isArray(payload) ? payload : [payload];
      if (records.length === 0) return NextResponse.json([]);

      const returned: any[] = [];
      for (const record of records) {
        const columns = Object.keys(record);
        const placeholders = columns.map((_, i) => `$${paramIndex + i}`).join(',');
        const recordParams = columns.map(col => record[col]);

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

      if (isSingle || isMaybeSingle) {
        return NextResponse.json(returned[0] || null);
      }
      return NextResponse.json(Array.isArray(payload) ? returned : returned[0]);
    }

    if (action === 'update') {
      const columns = Object.keys(payload);
      if (columns.length === 0) return NextResponse.json([]);

      const setAssignments = columns.map((col, idx) => `${col} = $${paramIndex + idx}`).join(', ');
      const updateParams = columns.map(col => payload[col]);
      
      params.unshift(...updateParams); // Put updates first in params array
      paramIndex += columns.length;

      sql = `UPDATE public.${table} SET ${setAssignments}`;
      sql += buildWhereClause();
      sql += ' RETURNING *';

      const res = await query(sql, params);
      
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
