import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'project_manager', 'administrator']

/**
 * Set who receives the exclusive lead sources (Google Ads, Website).
 * These sources are NOT shared with the whole pool — only flagged people.
 * Body: { marketer_id, source: 'google'|'website', enabled: boolean }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { marketer_id, source, enabled } = await req.json()
  if (!marketer_id || !['google', 'website'].includes(source)) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const col = source === 'google' ? 'gets_google_leads' : 'gets_website_leads'
  const sb = createServiceClient()
  const { error } = await sb.from('profiles').update({ [col]: !!enabled }).eq('id', marketer_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
