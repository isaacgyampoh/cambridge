import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { unavailable, saveFailed } from '@/lib/db/lookup'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * REMOVE A COURSE THAT NOTHING DEPENDS ON.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * /admin/courses could create and edit, and could set is_active — and that
 * was all. A course entered while the system was being demonstrated stayed on
 * the list for ever, disabled at best. The owner's words: the old ones "were
 * a demo or an old one", and the list should be "left with the ones that are
 * working".
 *
 * Disabling is not that. A disabled course still appears on this screen, is
 * still selectable in older forms, and still has to be read past every time
 * somebody looks for the cohort that is actually running.
 *
 * ── WHY THIS IS NOT JUST A DELETE ──────────────────────────────────────────
 *
 * Five tables carry course_id: batches, applications, admissions, invoices
 * and certificates. None declares ON DELETE, so Postgres refuses while any
 * row points at the course. That default is correct and is deliberately left
 * alone — a course is the thing an invoice was raised against and the thing a
 * certificate attests to, and cascading would quietly destroy the record of a
 * student's registration and payment along with a tidy-up.
 *
 * But the bare refusal arrives as a foreign-key violation, which names a
 * constraint rather than saying what is in the way. So the dependents are
 * counted FIRST and the refusal says what is holding the course and how much
 * of it, which is the difference between a dead end and a next step.
 *
 * ── A FAILED COUNT IS NOT A COUNT OF ZERO ──────────────────────────────────
 *
 * The check is only worth having if it cannot be passed by accident. If one
 * of these reads fails and the error is discarded, the count is null, null is
 * not greater than zero, and the delete proceeds — the guard reports "nothing
 * depends on this" on no evidence at all. Every count below is therefore
 * checked for its error and a failure stops the whole operation, because the
 * one thing worse than refusing to delete a course is deleting one whose
 * history could not be read.
 */

/** Every table that points at a course, and how to say so. */
const DEPENDENTS = [
  { table: 'batches',      one: 'class',        many: 'classes' },
  { table: 'applications', one: 'application',  many: 'applications' },
  { table: 'admissions',   one: 'admission',    many: 'admissions' },
  { table: 'invoices',     one: 'invoice',      many: 'invoices' },
  { table: 'certificates', one: 'certificate',  many: 'certificates' },
] as const

/** "2 classes and 1 application", or "3 invoices". */
function listPhrase(parts: string[]): string {
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: { valid?: boolean; role?: string; userId?: string } =
    token ? await verifySession(token) : { valid: false }

  if (!session.valid || !['super_admin', 'administrator'].includes(session.role || '')) {
    return NextResponse.json(
      { error: 'Only an administrator can delete a course.' },
      { status: 403 },
    )
  }

  const body = await req.json().catch(() => null) as { id?: string } | null
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'Which course?' }, { status: 400 })

  const sb = createServiceClient()

  // Read the name before deleting it, so the audit entry and the confirmation
  // can say which course this was rather than quoting an internal id.
  const { data: course, error: readError } = await sb
    .from('courses').select('id, name').eq('id', id).maybeSingle()

  if (readError) return unavailable('[admin/delete-course]', readError.message, 'that course')
  if (!course) return NextResponse.json({ error: 'That course no longer exists.' }, { status: 404 })

  const blocking: string[] = []
  for (const dep of DEPENDENTS) {
    const { count, error } = await sb
      .from(dep.table).select('id', { count: 'exact', head: true }).eq('course_id', id)

    /*
     * Not `if (count)`. A failed read must stop this, not sail through it —
     * see the note above.
     */
    if (error) {
      return unavailable('[admin/delete-course]', `${dep.table}: ${error.message}`,
        `what depends on ${course.name}`)
    }
    if (count && count > 0) {
      blocking.push(`${count} ${count === 1 ? dep.one : dep.many}`)
    }
  }

  if (blocking.length > 0) {
    await recordAudit({
      actorId: session.userId, action: 'courses.delete_blocked',
      resource: 'courses', resourceId: id, success: false, request: req,
      metadata: { blockedBy: blocking },
    })
    return NextResponse.json({
      error: `${course.name} still has ${listPhrase(blocking)} attached, so deleting it would take that history with it. `
        + 'Remove those first, or disable the course instead to take it off the active list.',
      blockedBy: blocking,
    }, { status: 409 })
  }

  const { error: deleteError } = await sb.from('courses').delete().eq('id', id)
  if (deleteError) {
    /*
     * Reachable if something attached itself between the count and the
     * delete. Postgres is the authority either way; this only makes its
     * refusal readable.
     */
    return saveFailed('[admin/delete-course]', deleteError.message, `the deletion of ${course.name}`)
  }

  await recordAudit({
    actorId: session.userId, action: 'courses.deleted',
    resource: 'courses', resourceId: id, success: true, request: req,
    metadata: { name: course.name },
  })

  return NextResponse.json({ success: true, name: course.name })
}
