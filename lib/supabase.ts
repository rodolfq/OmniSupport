import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Only initialize if we have valid-ish looking credentials to avoid build errors
const isValid = supabaseUrl.startsWith('http') && supabaseAnonKey.length > 0;

export const supabase = isValid 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function getSupabase() {
  return supabase;
}
