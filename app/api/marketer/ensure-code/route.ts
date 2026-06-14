import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Ensures the current marketer has a unique registration link code.
 * If they don't have one, generate it from their name + a short suffix.
 * Returns { marketer_code }.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const { data: me } = await sb.from('profiles').select('id, full_name, marketer_code').eq('id', session.userId!).maybeSingle()
  if (!me) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  if (me.marketer_code) return NextResponse.json({ marketer_code: me.marketer_code })

  // Generate a clean code from the first name + 4 random chars
  const base = (me.full_name || 'mkt').split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  let code = ''
  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6)
    const candidate = `${base}-${suffix}`
    const { data: clash } = await sb.from('profiles').select('id').eq('marketer_code', candidate).maybeSingle()
    if (!clash) { code = candidate; break }
  }
  if (!code) code = `mkt-${Date.now().toString(36)}`

  await sb.from('profiles').update({ marketer_code: code }).eq('id', me.id)
  return NextResponse.json({ marketer_code: code })
}
