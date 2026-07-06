import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'project_manager']

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { marketer_id, tier, lock } = await req.json()
  if (!marketer_id || !['high', 'mid', 'low', 'support'].includes(tier)) {
    return NextResponse.json({ error: 'Invalid tier.' }, { status: 400 })
  }
  const sb = createServiceClient()
  // Manually setting a tier locks it from auto-recalc (until unlocked)
  await sb.from('profiles').update({
    performance_tier: tier,
    tier_locked: lock !== false,
  }).eq('id', marketer_id)
  return NextResponse.json({ success: true })
}
