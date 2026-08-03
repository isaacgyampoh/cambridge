import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator']

/**
 * Remove sign-in accounts that no longer belong to any staff member.
 * Deleting staff through the portal removes their login too, but clearing the
 * database directly does not — which leaves "email already exists" on
 * re-onboarding. This clears those orphans.
 * GET = how many. POST = delete them.
 */
async function findOrphans(sb: any, meId: string) {
  const { data: profiles } = await sb.from('profiles').select('id').limit(5000)
  const kept = new Set((profiles || []).map((p: any) => p.id))

  const orphans: { id: string; email: string }[] = []
  for (let page = 1; page <= 20; page++) {
    const { data: list } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    const users = list?.users || []
    if (!users.length) break
    for (const u of users) {
      if (u.id === meId) continue          // never remove your own login
      if (!kept.has(u.id)) orphans.push({ id: u.id, email: u.email || '(no email)' })
    }
    if (users.length < 200) break
  }
  return orphans
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const orphans = await findOrphans(createServiceClient(), s.userId)
  return NextResponse.json({ orphans: orphans.length, emails: orphans.slice(0, 20).map(o => o.email) })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const orphans = await findOrphans(sb, s.userId)
  let removed = 0
  for (const o of orphans) {
    const { error } = await sb.auth.admin.deleteUser(o.id)
    if (!error) removed++
  }
  return NextResponse.json({ success: true, found: orphans.length, removed })
}
