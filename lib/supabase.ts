class SupabaseCompatChain {
  private tableName: string;
  private action: string;
  private payload: any;
  private filters: any[];
  private orderBy: any;
  private limitCount: number | null;
  private isSingle: boolean;
  private isMaybeSingle: boolean;
  private wantCount: 'exact' | 'planned' | 'estimated' | null;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.action = 'select';
    this.payload = null;
    this.filters = [];
    this.orderBy = null;
    this.limitCount = null;
    this.isSingle = false;
    this.isMaybeSingle = false;
    this.wantCount = null;
  }

  select(cols = '*', opts?: { count?: 'exact' | 'planned' | 'estimated' }) {
    this.wantCount = opts?.count || null;
    return this;
  }

  insert(payload: any) {
    this.action = 'insert';
    this.payload = payload;
    return this;
  }

  upsert(payload: any) {
    this.action = 'upsert';
    this.payload = payload;
    return this;
  }

  update(payload: any) {
    this.action = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push({ type: 'eq', col, val });
    return this;
  }

  neq(col: string, val: any) {
    this.filters.push({ type: 'neq', col, val });
    return this;
  }

  in(col: string, vals: any[]) {
    this.filters.push({ type: 'in', col, val: vals });
    return this;
  }

  or(expr: string) {
    this.filters.push({ type: 'or', val: expr });
    return this;
  }

  not(col: string, operator: string, val: any) {
    this.filters.push({ type: 'not', col, operator, val });
    return this;
  }

  gt(col: string, val: any) {
    this.filters.push({ type: 'gt', col, val });
    return this;
  }

  gte(col: string, val: any) {
    this.filters.push({ type: 'gte', col, val });
    return this;
  }

  lt(col: string, val: any) {
    this.filters.push({ type: 'lt', col, val });
    return this;
  }

  lte(col: string, val: any) {
    this.filters.push({ type: 'lte', col, val });
    return this;
  }

  // ILIKE do Postgres — `%` já vem embutido no `pattern` de quem chama
  // (ex: `%${termo}%`), igual à API real do Supabase.
  ilike(col: string, pattern: string) {
    this.filters.push({ type: 'ilike', col, val: pattern });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, ascending: opts?.ascending !== false };
    return this;
  }

  range(from: number, to: number) {
    this.limitCount = to - from + 1;
    this.filters.push({ type: 'offset', val: from });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  abortSignal(sig: any) {
    return this;
  }

  // Assinatura compatível com PromiseLike<T> de propósito — sem isso, `await`
  // num SupabaseCompatChain (usado em código como `await supabase.from(...).select(...)`
  // por todo o app) não type-checka: TS exige que um "thenable" tenha `then`
  // com essa forma (callbacks opcionais) pra aceitar `await`/encadear
  // `.then()` normalmente. Resolve também o `data`/`error` como `any`
  // implícito (virava erro em cascata em quem desestruturava o retorno).
  // Comportamento em runtime não muda — só a tipagem.
  then<TResult1 = { data: any; error: any; count?: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    const run = async (): Promise<{ data: any; error: any; count?: number | null }> => {
      try {
        const res = await fetch('/api/compat/supabase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            table: this.tableName,
            action: this.action,
            payload: this.payload,
            filters: this.filters,
            orderBy: this.orderBy,
            limitCount: this.limitCount,
            isSingle: this.isSingle,
            isMaybeSingle: this.isMaybeSingle,
            wantCount: this.wantCount
          })
        });

        if (!res.ok) {
          const errorData = await res.json();
          return { data: null, error: { message: errorData.error || 'Request failed' } };
        }

        const body = await res.json();
        // Forma especial só usada quando wantCount foi pedido (ver
        // route.ts) — em todo o resto dos casos `body` já é o array/objeto
        // de linhas direto, sem wrapper, pra não mudar o formato que o
        // resto do app já espera.
        if (this.wantCount && body && typeof body === 'object' && !Array.isArray(body) && 'rows' in body) {
          return { data: body.rows, error: null, count: body.count ?? null };
        }
        return { data: body, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err?.message || String(err) } };
      }
    };
    return run().then(onfulfilled, onrejected);
  }
}

export const supabase = {
  from(tableName: string) {
    return new SupabaseCompatChain(tableName);
  },
  channel(name: string) {
    return {
      on(event: string, opts: any, cb: any) {
        return this;
      },
      // Stub: sem realtime de verdade nesse compat layer, então o callback
      // nunca é chamado — mas precisa aceitar o argumento, senão quebra em
      // TS (e em runtime, se algum dia passar a chamá-lo) todo código que
      // faz `channel.subscribe((status) => ...)` esperando saber quando a
      // inscrição foi confirmada.
      subscribe(cb?: (status: string) => void) {
        return this;
      }
    };
  },
  removeChannel(chan: any) {
    return;
  },
  // Stub: autenticação real é via JWT próprio (ver lib/jwt.ts), não Supabase
  // Auth — existe só pra código legado que ainda chama `supabase.auth.*` não
  // quebrar em runtime (TicketService.create, hoje sem nenhum chamador,
  // cai no fallback `ticket.customerId` quando session vem null).
  auth: {
    async getSession(): Promise<{ data: { session: { user: { id: string } } | null }; error: null }> {
      return { data: { session: null }, error: null };
    }
  },
  storage: {
    from(bucketName: string) {
      return {
        async upload(path: string, file: any, options?: any) {
          return { data: { path }, error: null };
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `/uploads/${path}` } };
        }
      };
    }
  }
};

export function getSupabase() {
  return supabase;
}

export function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('omni_session_active') === 'true';
}
