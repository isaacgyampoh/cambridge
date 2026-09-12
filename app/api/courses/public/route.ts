import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Public: active course names, for the dropdowns on public forms.
 *
 * ── WHY THIS ROUTE NOW REPORTS FAILURE ─────────────────────────────────────
 *
 * It read `const { data } = await sb.from('courses')...` and returned
 * `data || []`, discarding the error. So a database that refused the read —
 * an expired service key, a policy change, an outage — produced exactly the
 * same response as a centre with no courses:
 *
 *     { "courses": [], "list": [] }
 *
 * That is not a hypothetical. It is how a previous audit of this system
 * concluded, in writing, that the centre had no active courses. The local
 * service key was invalid, every server-side read was failing with a 401,
 * and three endpoints all answered "empty" in a calm and confident voice.
 * Production had three courses with fees on them the whole time.
 *
 * An empty list is now only ever an empty table. A failed read says so, and
 * the caller can tell the difference.
 */
export async function GET() {
  const sb = createServiceClient()
  const { data, error } = await sb.from('courses')
    .select('id, name').eq('is_active', true).order('name')

  if (error) {
    console.error('[courses/public] could not read courses:', error.message)
    return NextResponse.json(
      { error: 'The programme list could not be loaded.' },
      { status: 503 },
    )
  }

  const rows = data || []
  return NextResponse.json({
    courses: rows.map(c => c.name),                        // backward-compat: names
    list: rows.map(c => ({ id: c.id, name: c.name })),     // id + name
  })
}
