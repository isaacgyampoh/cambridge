import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * PUBLIC: resolve a marketer from their link code, server-side (service role).
 * The apply page previously queried profiles from the BROWSER, which RLS
 * blocks for anonymous visitors — so the marketer silently resolved to null
 * and every lead from a personal link came in UNASSIGNED. This endpoint makes
 * resolution reliable and only exposes safe display fields.
 */
export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('code')
  if (!code) return NextResponse.json({ marketer: null })
  const sb = createServiceClient()
  const { data } = await sb.from('profiles')
    .select('id, full_name, marketer_code, is_active')
    .eq('marketer_code', code).maybeSingle()
  if (!data || data.is_active === false) return NextResponse.json({ marketer: null })
  return NextResponse.json({ marketer: { id: data.id, full_name: data.full_name, marketer_code: data.marketer_code } })
}
