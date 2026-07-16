class SupabaseCompatChain {
  private tableName: string;
  private action: string;
  private payload: any;
  private filters: any[];
  private orderBy: any;
  private limitCount: number | null;
  private isSingle: boolean;
  private isMaybeSingle: boolean;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.action = 'select';
    this.payload = null;
    this.filters = [];
    this.orderBy = null;
    this.limitCount = null;
    this.isSingle = false;
    this.isMaybeSingle = false;
  }

  select(cols = '*') {
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

  async then(resolve: any, reject: any) {
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
          isMaybeSingle: this.isMaybeSingle
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        return resolve({ data: null, error: { message: errorData.error || 'Request failed' } });
      }

      const data = await res.json();
      return resolve({ data, error: null });
    } catch (err: any) {
      return resolve({ data: null, error: { message: err?.message || String(err) } });
    }
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
      subscribe() {
        return this;
      }
    };
  },
  removeChannel(chan: any) {
    return;
  },
  storage: {
    from(bucketName: string) {
      return {
        async upload(path: string, file: any, options: any) {
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
