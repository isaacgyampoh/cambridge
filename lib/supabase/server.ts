import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { CONFIG } from '@/lib/config'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {}
      },
    },
  })
}

export function createServiceClient() {
  return createSupabaseClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey)
}
