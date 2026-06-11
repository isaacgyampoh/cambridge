import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const sb = createServiceClient()
  const results: Record<string, boolean> = {}

  try {
    await sb.from('profiles').select('id').limit(1)
    results.schema = true
  } catch { results.schema = false }

  try {
    const { data } = await sb.from('profiles').select('id').eq('role', 'super_admin').limit(1)
    results.admin = (data?.length || 0) > 0
  } catch { results.admin = false }

  try {
    await sb.from('pin_sessions').select('id').limit(1)
    results.sessions = true
  } catch { results.sessions = false }

  return NextResponse.json(results)
}
