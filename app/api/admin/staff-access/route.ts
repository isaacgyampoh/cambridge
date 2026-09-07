import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { PORTAL_PATHS, PORTAL_EXACT_PATHS } from '@/lib/access/portals'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * Set one member of staff's access.
 *
 * ── WHY THIS ROUTE HAD TO EXIST ────────────────────────────────────────────
 *
 * The staff screens wrote these columns straight through /api/data:
 *
 *     PATCH /api/data { table: 'profiles', data: { portals: [...] } }
 *     PATCH /api/data { table: 'profiles', data: { is_active: false } }
 *
 * Both `portals` and `is_active` are in UNWRITABLE_COLUMNS — deliberately,
 * and correctly: that endpoint runs client-supplied writes with the service
 * role, so anything on that list would let a signed-in user hand themselves a
 * role or a portal. The PATCH is refused with a 400.
 *
 * Neither caller read the response. Both announced success.
 *
 * So: pressing Save on the permissions screen changed nothing at all and said
 * "Permissions updated for <name>!". Deactivating a member of staff changed
 * nothing and said "Deactivated" — a departed employee kept working access,
 * and the administrator had been told otherwise. Adding somebody to the lead
 * pool did nothing either.
 *
 * That is why granting a portal never fixed anyone's missing leads. The grant
 * was never written.
 *
 * The columns stay unwritable. This is the audited, role-guarded way to
 * change them.
 *
 * ── WHAT IT WILL NOT LET YOU DO ────────────────────────────────────────────
 *
 * Grant a portal you do not hold yourself; touch a super admin unless you are
 * one; deactivate yourself; or deactivate the last active super admin. The
 * first stops an administrator quietly promoting themselves through a screen
 * built for delegating access. The rest stop somebody locking the centre out
 * of its own system.
 */

/** Every portal id that actually unlocks something. */
const KNOWN_PORTALS = new Set([
  'dashboard',
  ...Object.keys(PORTAL_PATHS),
  ...Object.keys(PORTAL_EXACT_PATHS),
])

const Body = z.object({
  id: z.string().uuid('That staff reference is not valid.'),
  portals: z.array(z.string().max(40)).max(60).optional(),
  is_active: z.boolean().optional(),
  in_lead_pool: z.boolean().optional(),
})

export const POST = withGuard({ portals: ['staff'] }, async (req: NextRequest, { session, portals: mine }) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'That change could not be read.' },
      { status: 400 },
    )
  }
  const { id, portals, is_active, in_lead_pool } = parsed.data

  if (portals === undefined && is_active === undefined && in_lead_pool === undefined) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  const sb = createServiceClient()
  const superAdmin = session.role === 'super_admin'

  const { data: target } = await sb.from('profiles')
    .select('id, full_name, role, is_active').eq('id', id).maybeSingle()

  if (!target) {
    return NextResponse.json({ error: 'That staff member no longer exists.' }, { status: 404 })
  }

  // Only a super admin may change a super admin.
  if (target.role === 'super_admin' && !superAdmin) {
    return NextResponse.json(
      { error: 'Only a super admin can change another super admin’s access.' },
      { status: 403 },
    )
  }

  const update: Record<string, unknown> = {}

  // ── portals ──────────────────────────────────────────────────────────────
  if (portals !== undefined) {
    const unknown = portals.filter(p => !KNOWN_PORTALS.has(p))
    if (unknown.length) {
      return NextResponse.json(
        { error: `Not a real permission: ${unknown.slice(0, 3).join(', ')}.` },
        { status: 400 },
      )
    }

    /*
     * You cannot give away what you do not have.
     *
     * Without this, an administrator — who reaches this screen to delegate
     * access — could grant themselves `settings`, which is the portal that
     * governs the system. A super admin is unrestricted; everyone else may
     * only pass on their own.
     */
    if (!superAdmin) {
      const beyond = portals.filter(p => p !== 'dashboard' && !mine.includes(p))
      if (beyond.length) {
        return NextResponse.json(
          { error: `You cannot grant access you do not have yourself: ${beyond.slice(0, 3).join(', ')}.` },
          { status: 403 },
        )
      }
    }

    // Dashboard is everyone's; storing it keeps the saved list self-contained,
    // because resolvePortals treats a saved list as the whole of the access.
    update.portals = Array.from(new Set(['dashboard', ...portals]))
  }

  // ── is_active ────────────────────────────────────────────────────────────
  if (is_active !== undefined) {
    if (id === session.userId && !is_active) {
      return NextResponse.json(
        { error: 'You cannot deactivate your own account.' },
        { status: 400 },
      )
    }

    /*
     * The last super admin stays. verifySession refuses an inactive profile on
     * every request, so deactivating the only one locks the centre out of its
     * own system with no way back in through the product.
     */
    if (!is_active && target.role === 'super_admin') {
      const { count } = await sb.from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin').eq('is_active', true)
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'This is the last active super admin. Promote someone else first.' },
          { status: 400 },
        )
      }
    }

    update.is_active = is_active
  }

  if (in_lead_pool !== undefined) update.in_lead_pool = in_lead_pool

  const { error } = await sb.from('profiles').update(update).eq('id', id)

  if (error) {
    console.error('[staff-access] update failed for', id, error.message)
    return NextResponse.json(
      { error: 'That change could not be saved. Please try again.' },
      { status: 500 },
    )
  }

  await recordAudit({
    actorId: session.userId,
    action: 'staff.access_changed',
    resource: 'profiles',
    resourceId: id,
    success: true,
    metadata: { changed: Object.keys(update), portals, is_active, in_lead_pool },
    request: req,
  })

  return NextResponse.json({ success: true })
})
