import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { longDate } from '@/lib/chatbot/format'
import type { Cohort, Programme } from '@/lib/chatbot/programmeRules'
import { canonicalisePublicUrl } from '@/lib/url'

/**
 * Reading the programmes out of the database.
 *
 * The rules about what may then be said live in lib/chatbot/programmeRules,
 * which is pure and under test. This file is only the read.
 *
 * ── A COLUMN THAT MAY NOT EXIST ────────────────────────────────────────────
 *
 * The knowledge loader this replaces selected `courses.price`. The Course
 * interface in types/index.ts has no such field, and the admin screen that
 * creates and edits courses writes `course_fee`, `course_fee_online` and
 * `registration_fee`. PostgREST fails the WHOLE select when a named column is
 * missing, so if `price` is not there, the courses read has been returning
 * nothing — and an assistant told to quote fees "only from the facts below"
 * has had no fees in front of it at all. Which is the exact condition the
 * no-guessing rule exists to prevent.
 *
 * Only columns the type and the admin screen both confirm are named here, and
 * the read falls back to a minimal set and says so, so a schema that differs
 * from this repository degrades to less information rather than to none.
 */

export * from '@/lib/chatbot/programmeRules'

/**
 * The result of a load that can genuinely fail.
 *
 * ── WHY THIS IS NOT JUST AN ARRAY ──────────────────────────────────────────
 *
 * It was. `loadProgrammes` returned `[]` when the query failed, which made a
 * database error indistinguishable from a centre with no programmes — and the
 * assistant treats the second as "find out which one they mean" rather than
 * "something is wrong". That is the courses.price failure repeating in a new
 * place: a silent empty result standing in for a broken read.
 *
 * NO DATA and DATA LOAD FAILED are different states and the callers behave
 * differently on each. An empty centre is a conversation to have; an
 * unreadable database is a conversation to hand to a person.
 */
export type LoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/** The columns the Course type and the admin screen both confirm exist. */
const COURSE_COLUMNS =
  'id, name, code, description, duration, course_fee, course_fee_online, registration_fee, brochure_url'
/** Enough to name a programme at all, if the fuller read is refused. */
const COURSE_MINIMAL = 'id, name, code'

type CourseRecord = {
  id: string; name: string; code?: string | null
  description?: string | null; duration?: string | null
  course_fee?: number | string | null
  course_fee_online?: number | string | null
  registration_fee?: number | string | null
  brochure_url?: string | null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Read the active programmes.
 *
 * Falls back to a minimal column set if the fuller one is refused, and says
 * so, because a schema that differs from this repository should cost detail
 * rather than costing the assistant every fact it has.
 */
export async function loadProgrammes(): Promise<LoadResult<Programme[]>> {
  const sb = createServiceClient()

  let rows: CourseRecord[] | null = null
  const full = await sb.from('courses').select(COURSE_COLUMNS)
    .eq('is_active', true).order('name').limit(100)

  if (full.error) {
    console.error('[chatbot] courses: full read refused —', full.error.message,
      '— falling back to names only. Fees and brochures will be unavailable.')
    const minimal = await sb.from('courses').select(COURSE_MINIMAL)
      .eq('is_active', true).order('name').limit(100)
    if (minimal.error) {
      /*
       * Not an empty array. The caller must be able to tell this from a
       * centre that has no programmes, because the right behaviour differs:
       * one is a question to ask, the other is a conversation to hand over.
       */
      console.error('[chatbot] courses unreadable entirely:', minimal.error.message)
      return { ok: false, error: minimal.error.message }
    }
    rows = minimal.data as CourseRecord[]
  } else {
    rows = full.data as CourseRecord[]
  }

  if (!rows?.length) return { ok: true, data: [] }

  // Cohorts, in one read rather than one per programme.
  const byCourse = new Map<string, Cohort[]>()
  const { data: batches, error: bErr } = await sb.from('batches')
    .select('name, course_id, class_type, status, start_date, schedule, venue')
    .in('status', ['upcoming', 'ongoing'])
    .order('start_date', { ascending: true }).limit(100)
  if (bErr) console.error('[chatbot] batches unreadable:', bErr.message)

  for (const b of (batches || []) as Array<Record<string, unknown>>) {
    const courseId = String(b.course_id || '')
    if (!courseId) continue
    const list = byCourse.get(courseId) || []
    list.push({
      name: String(b.name || ''),
      startDate: (b.start_date as string) || null,
      startDateText: longDate(b.start_date as string),
      schedule: (b.schedule as string) || null,
      venue: (b.venue as string) || null,
      online: b.class_type === 'online',
      running: b.status === 'ongoing',
    })
    byCourse.set(courseId, list)
  }

  return {
    ok: true,
    data: rows.map(r => ({
      id: r.id,
      name: r.name,
      code: r.code || null,
      description: r.description || null,
      duration: r.duration || null,
      feeInPerson: num(r.course_fee),
      feeOnline: num(r.course_fee_online),
      registrationFee: num(r.registration_fee),
      /*
       * Repaired on the way out. These are stored absolute, and rows saved
       * while NEXT_PUBLIC_APP_URL pointed at a deployment alias hold
       * `https://cambridge-mu.vercel.app/brochures/…`. This is the canonical
       * loader behind the public page, the marketing page and the chatbot, so
       * fixing it here fixes it everywhere a brochure is offered.
       */
      brochureUrl: canonicalisePublicUrl(r.brochure_url),
      cohorts: byCourse.get(r.id) || [],
    })),
  }
}

