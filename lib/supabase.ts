import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Singleton robusto usando o cliente padrão
let instance: ReturnType<typeof createClient> | null = null

export const supabase = (() => {
  if (typeof window === 'undefined') {
    // Server-side
    return createClient(supabaseUrl, supabaseAnonKey);
  }

  if (!instance) {
    instance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'sb-auth-v5-token',
        flowType: 'pkce'
      }
    })
    console.log('⚡ Supabase Client: Inicializado com persistência v5')
  }
  return instance
})()

export function getSupabase() {
  return supabase
}

// Função para verificar se há sessão no localStorage
export function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem('sb-auth-v5-token');
    if (stored) {
      const parsed = JSON.parse(stored);
      return !!parsed?.access_token && !!parsed?.user;
    }
  } catch {
    return false;
  }
  return false;
}
