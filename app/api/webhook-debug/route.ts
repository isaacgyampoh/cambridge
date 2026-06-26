import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Temporary: view the last few webhook hits to diagnose lead flow.
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const sb = createServiceClient()
  const { data } = await sb.from('webhook_debug').select('*').order('created_at', { ascending: false }).limit(20)
  return NextResponse.json({ events: data || [] })
}
