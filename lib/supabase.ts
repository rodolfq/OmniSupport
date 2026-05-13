import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Singleton robusto usando o cliente padrão
let instance: ReturnType<typeof createClient> | null = null

export const supabase = typeof window !== 'undefined'
  ? (() => {
      if (!instance) {
        instance = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: 'sb-auth-v5-token', 
          }
        })
        console.log('⚡ Supabase Client: Inicializado com persistência v5')
      }
      return instance
    })()
  : null

export function getSupabase() {
  return supabase
}
