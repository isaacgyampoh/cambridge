import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { ROLE_DEFAULTS, DUTIES } from '@/lib/access/portals'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator']

/**
 * Repair staff whose saved access replaced their role's own sections.
 * Anyone onboarded with a duty ticked had ONLY that duty's portals stored, so a
 * content manager who also markets lost the content section. This rebuilds
 * each person's access as: what their role grants, plus anything extra they
 * were given.
 * GET = who would change. POST = fix them.
 */
async function plan(sb: any) {
  const { data: staff } = await sb.from('profiles')
    .select('id, full_name, role, portals').neq('role', 'student').limit(500)

  const changes: any[] = []
  for (const p of staff || []) {
    const roleGrants = ROLE_DEFAULTS[p.role] || ['dashboard']
    const saved: string[] = Array.isArray(p.portals) ? p.portals : []
    if (!saved.length) continue                       // already using role defaults

    const missing = roleGrants.filter(x => !saved.includes(x))
    if (!missing.length) continue                     // nothing lost

    const merged = Array.from(new Set([...roleGrants, ...saved]))
    changes.push({ id: p.id, name: p.full_name, role: p.role, missing, merged })
  }
  return changes
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const changes = await plan(createServiceClient())
  return NextResponse.json({
    affected: changes.length,
    people: changes.map(c => ({ name: c.name, role: c.role, restoring: c.missing })),
  })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const changes = await plan(sb)
  let fixed = 0
  for (const ch of changes) {
    const { error } = await sb.from('profiles').update({ portals: ch.merged }).eq('id', ch.id)
    if (!error) fixed++
  }
  return NextResponse.json({ success: true, fixed, people: changes.map(c => c.name) })
}
