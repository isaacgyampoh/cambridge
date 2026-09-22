import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { recordAudit } from '@/lib/audit'
import { lookup, unavailable, saveFailed } from '@/lib/db/lookup'
import { ADMISSIONS_ROLES } from '@/lib/admissions/letterPolicy'

export const runtime = 'nodejs'

/**
 * Admit a student. Body: { admissionId }
 *
 * ── ADMITTING DOES NOT SEND THE ADMISSION LETTER ───────────────────────────
 *
 * This route used to set the admission to 'admitted' and then, in the same
 * request, email the admission letter and text the student "check your email
 * for your admission letter". It also wrote admission_letter_sent: true
 * before it had tried to send anything.
 *
 * Approving an admission and issuing the letter are two different acts. The
 * letter is an official document that carries the programme fee and a date,
 * and Admissions must see exactly what it says before it leaves. So this now
 * records the decision and nothing else. The letter is sent from the
 * admission record with "Send admission letter", which shows the current fee,
 * today's date and the recipient and sends only on explicit confirmation —
 * see /api/admissions/letter.
 *
 * admission_letter_sent is no longer touched here. It must mean that a letter
 * actually went, and only the sending route can know that.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid || !ADMISSIONS_ROLES.includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const { admissionId } = await req.json().catch(() => ({}))
  if (!admissionId) return NextResponse.json({ error: 'Missing admissionId' }, { status: 400 })

  const sb = createServiceClient()
  const { row: adm, failed } = await lookup(
    sb.from('admissions')
      .select('id, admission_number, course:course_id(name)')
      .eq('id', admissionId).maybeSingle(),
  )
  if (failed) return unavailable('[admissions/admit]', failed, 'that admission')
  if (!adm) return NextResponse.json({ error: 'Admission not found' }, { status: 404 })

  /*
   * The admission number comes from the same sequence registration uses. It
   * was `Math.floor(1000 + Math.random() * 9000)` here — four random digits
   * with a UNIQUE constraint behind them, so a collision failed the update
   * and the admission silently stayed un-admitted.
   */
  let admissionNo = adm.admission_number as string | null
  if (!admissionNo) {
    const { data: nextNo } = await sb.rpc('next_admission_number')
    admissionNo = (nextNo as string) || `CCE/${new Date().getFullYear()}/${Date.now().toString().slice(-6)}`
  }

  /*
   * Only columns that certainly exist. `admitted_at` appears in no schema file
   * or migration, and PostgREST refuses the WHOLE update when one named column
   * is missing — so it was written in the same statement as the status, and
   * that statement's error was discarded. If the column is absent, admitting
   * has been failing silently while answering "admitted".
   */
  const { error: updateError } = await sb.from('admissions').update({
    status: 'admitted',
    admission_number: admissionNo,
  }).eq('id', admissionId)

  // This was discarded, so a refused update still answered "admitted".
  if (updateError) return saveFailed('[admissions/admit]', updateError.message, 'that admission')

  // The timestamp is a nicety; its absence must not undo the decision.
  await sb.from('admissions').update({ admitted_at: new Date().toISOString() })
    .eq('id', admissionId).then(() => {}, () => {})

  await recordAudit({
    actorId: session.userId,
    action: 'admissions.admitted',
    resource: 'admissions',
    resourceId: admissionId,
    success: true,
    metadata: {
      admissionNo,
      courseName: (adm.course as { name?: string } | null)?.name ?? null,
      letterSent: false,
    },
  })

  return NextResponse.json({
    success: true,
    admissionNo,
    // Said plainly so the screen can point at the next step rather than
    // implying the student has been told anything.
    letterSent: false,
    next: 'The student has been admitted. Nothing has been sent to them yet — use "Send admission letter" when the letter is ready to go.',
  })
}
