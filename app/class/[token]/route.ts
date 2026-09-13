import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { lookup } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * Single-use class entry. Consumes the token, records attendance, then
 * redirects to Zoom. A shared or reused URL lands on the portal instead.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const sb = createServiceClient()
  const home = new URL('/portal', req.url)

  const { row: t, failed } = await lookup(
    sb.from('class_access_tokens').select('*').eq('token', token).maybeSingle(),
  )
  // Entry fails CLOSED — an unreadable token is not an admitted student — but
  // it is logged, because the student sees only the portal and will say the
  // link "did nothing".
  if (failed) console.error('[class/token] token read failed:', failed)
  if (failed || !t || t.used || (t.expires_at && new Date(t.expires_at).getTime() < Date.now())) {
    return NextResponse.redirect(home, { status: 302 })
  }

  /*
   * ── RESOLVE THE LINK BEFORE SPENDING THE TOKEN ───────────────────────────
   *
   * The token was marked used here, above this block. When the class had no
   * Zoom link — nobody had set one yet, or the current section was missing
   * one — the student was redirected to the portal with their single-use
   * token already spent. Clicking again landed on the portal too, because the
   * token was now `used`. They had no way back in, and nothing anywhere
   * recorded that they had tried.
   *
   * Resolving first costs two reads that were happening anyway, and means a
   * token is only ever spent on a journey that actually leads to the class.
   */
  let target: string | null = null
  const { row: sec, failed: secFailed } = await lookup(
    sb.from('class_sections')
      .select('zoom_link').eq('batch_id', t.batch_id).eq('is_current', true).maybeSingle(),
  )
  if (secFailed) console.error('[class/token] section read failed:', secFailed)
  target = sec?.zoom_link || null

  if (!target) {
    const { row: b, failed: batchFailed } = await lookup(
      sb.from('batches').select('zoom_link').eq('id', t.batch_id).maybeSingle(),
    )
    if (batchFailed) console.error('[class/token] batch read failed:', batchFailed)
    target = b?.zoom_link || null
  }
  // Token NOT spent: they can try again once somebody sets the link.
  if (!target) return NextResponse.redirect(home, { status: 302 })

  /*
   * ── SPEND IT, ONCE ───────────────────────────────────────────────────────
   *
   * `.eq('used', false)` is what makes this single-use rather than
   * nearly-single-use. Reading the token and then updating it left a window
   * in which two people holding the same forwarded URL both passed the check
   * before either wrote — and both got in, which is the one thing the token
   * exists to prevent.
   *
   * Asking for the row back is how we find out which of them won.
   */
  const { data: claimed, error: claimErr } = await sb.from('class_access_tokens')
    .update({ used: true }).eq('token', token).eq('used', false).select('id')

  if (claimErr) {
    // Could not establish whether this token was still unspent. Refusing is
    // the safe side of that, and it is recoverable — the token is untouched.
    console.error('[class/token] could not claim token:', claimErr.message)
    return NextResponse.redirect(home, { status: 302 })
  }
  if (!claimed?.length) {
    // Somebody else spent it between the read and here.
    return NextResponse.redirect(home, { status: 302 })
  }

  // Record attendance
  try {
    const { row: enr, failed: enrFailed } = await lookup(
      sb.from('class_enrollments')
        .select('id, full_name, phone').eq('lead_id', t.lead_id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    )
    if (enrFailed) console.error('[class/token] enrolment read failed:', enrFailed)

    if (enr) {
      const today = new Date().toISOString().slice(0, 10)
      const { row: seen, failed: seenFailed } = await lookup(
        sb.from('class_signins')
          .select('id').eq('enrollment_id', enr.id).eq('session_date', today).maybeSingle(),
      )
      /*
       * Read as "not signed in yet", a failed read writes a second attendance
       * row for the same student on the same day. Attendance is what the
       * completion gate and the certificate are decided on, so a double count
       * is not cosmetic.
       *
       * Skipping is the right way to be wrong here: the student is already
       * through to the class, and a missing sign-in is visible and fixable in
       * a way a phantom duplicate is not.
       */
      if (seenFailed) {
        console.error('[class/token] sign-in check failed; not recording attendance twice:', seenFailed)
      } else if (!seen) {
        await sb.from('class_signins').insert({
          batch_id: t.batch_id, enrollment_id: enr.id,
          student_name: enr.full_name, phone: enr.phone, session_date: today,
        })
      }
    }
  } catch {}

  return NextResponse.redirect(target, { status: 302 })
}
