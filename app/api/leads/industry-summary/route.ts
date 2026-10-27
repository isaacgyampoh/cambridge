import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { columnExists } from '@/lib/db/hasColumn'
import { groupByIndustry } from '@/lib/leads/industryStats'
import { lookup, unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * A person's leads, counted by industry.
 *
 * ── WHY THE COUNTS COME FROM HERE AND NOT THE BROWSER ──────────────────────
 *
 * The leads list in the browser holds one page of leads. Counting the groups
 * there would count that page — so a marketer with four hundred leads would
 * see "Mining 12" meaning twelve on this screen, next to a quota figure
 * covering all four hundred, and the two would never agree.
 *
 * These are counted across every lead the person owns, in one query, which is
 * also what makes the group totals add up to the figure the quota is measured
 * against.
 *
 * ── WHOSE LEADS ────────────────────────────────────────────────────────────
 *
 * Your own, unless you are one of the roles that manages other people's — the
 * same list the rest of the system uses. Asking for somebody else's without
 * that is refused rather than quietly answered about yourself, because a
 * silent substitution is how a manager comes to believe they are looking at
 * a colleague's figures.
 */

const MANAGERS = ['super_admin', 'project_manager', 'administrator']

export const GET = withGuard(
  { portals: ['leads', 'my_leads', 'pm_leads'] },
  async (req: NextRequest, { session }) => {
    const url = new URL(req.url)
    const staffId = url.searchParams.get('staffId')
    const scope = url.searchParams.get('scope')
    const manager = MANAGERS.includes(String(session.role))

    if ((staffId && staffId !== session.userId) || scope === 'all') {
      if (!manager) {
        return NextResponse.json(
          { error: 'You can only see the industries of your own leads.' },
          { status: 403 },
        )
      }
    }

    /*
     * The column arrives with migration 0028. Asked rather than assumed: a
     * select naming a column that does not exist fails the whole read, and a
     * leads screen that cannot load is a far worse outcome than one with no
     * industry groups on it.
     */
    if (!(await columnExists('leads', 'industry'))) {
      return NextResponse.json({
        available: false,
        reason: 'This database has no industry column yet, so leads cannot be grouped by industry.',
        groups: [], total: 0, unstated: 0,
      })
    }

    const sb = createServiceClient()
    let query = sb.from('leads').select('industry, status, course_interest')

    if (scope === 'all' && manager) {
      // Everything, for a manager looking at the whole desk.
    } else {
      query = query.eq('assigned_to', staffId || session.userId)
    }

    // `lookup` returns the payload as `row`; for a multi-row select that is
    // the array. The name is the helper's, not a single-row claim.
    const { row: rows, failed } = await lookup(query)
    /*
     * A failed read is not an empty desk. Answering with zeroes would tell a
     * marketer they have no leads, which is a sentence they would act on.
     */
    if (failed) return unavailable('[leads/industry-summary]', failed, 'your leads')

    const breakdown = groupByIndustry((rows as Array<{ industry: string | null; status: string | null; course_interest: string | null }>) || [])
    return NextResponse.json({ available: true, ...breakdown })
  },
)
