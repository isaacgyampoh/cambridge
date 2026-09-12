import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { lookup, unavailable } from '@/lib/db/lookup'

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
  const { row: me, failed } = await lookup(
    sb.from('profiles').select('id, full_name, marketer_code').eq('id', session.userId!).maybeSingle(),
  )
  if (failed) return unavailable('[marketer/ensure-code]', failed, 'your profile')
  if (!me) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  if (me.marketer_code) return NextResponse.json({ marketer_code: me.marketer_code })

  // Generate a clean code from the first name + 4 random chars
  const base = (me.full_name || 'mkt').split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  let code = ''
  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6)
    const candidate = `${base}-${suffix}`
    /*
     * This read decides whether a referral code is free, and it used to fail
     * OPEN: a failed read produced `clash === null`, which reads as "nobody
     * has this code" and the candidate was taken. Two marketers can then hold
     * one code, and every lead arriving on it is credited to whichever row is
     * found first — silently, and for good.
     */
    const { row: clash, failed: clashFailed } = await lookup(
      sb.from('profiles').select('id').eq('marketer_code', candidate).maybeSingle(),
    )
    if (clashFailed) return unavailable('[marketer/ensure-code]', clashFailed, 'your link code')
    if (!clash) { code = candidate; break }
  }
  if (!code) code = `mkt-${Date.now().toString(36)}`

  await sb.from('profiles').update({ marketer_code: code }).eq('id', me.id)

  // Verify it saved
  const { row: check, failed: checkFailed } = await lookup(
    sb.from('profiles').select('marketer_code').eq('id', me.id).maybeSingle(),
  )
  // Without this the message below blames a missing column for what may have
  // been a save that worked and a read-back that did not.
  if (checkFailed) return unavailable('[marketer/ensure-code]', checkFailed, 'your link code')
  if (!check?.marketer_code) {
    return NextResponse.json({ error: 'Could not save link code. The marketer_code column may be missing — run the latest schema.' }, { status: 500 })
  }
  return NextResponse.json({ marketer_code: check.marketer_code })
}
