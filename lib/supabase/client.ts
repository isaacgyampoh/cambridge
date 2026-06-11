'use client'
import { createBrowserClient } from '@supabase/ssr'
import { CONFIG } from '@/lib/config'

export function createClient() {
  return createBrowserClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
}
