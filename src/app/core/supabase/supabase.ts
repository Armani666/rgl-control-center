import { createClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';

const supabaseUrl = environment.supabase.url;
const supabaseAnonKey = environment.supabase.anonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export function assertSupabaseConfigured(): void {
  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    supabaseUrl.includes('YOUR_PROJECT_ID') ||
    supabaseAnonKey.includes('YOUR_SUPABASE_ANON_KEY')
  ) {
    throw new Error(
      'Configura Supabase en src/environments/environment.ts y environment.prod.ts antes de usar la app.'
    );
  }
}
