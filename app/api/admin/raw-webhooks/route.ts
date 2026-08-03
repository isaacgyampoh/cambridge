import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator']

/** Show the exact payloads WaSender is sending, so the format can be matched. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data } = await sb.from('webhook_inbox')
    .select('created_at, outcome, detail, from_phone, body_text, raw')
    .order('created_at', { ascending: false }).limit(15)

  // Which event names have we been receiving, and how often?
  const events: Record<string, number> = {}
  const outcomes: Record<string, number> = {}
  for (const r of data || []) {
    const ev = (r.raw as any)?.event || '(no event field)'
    events[ev] = (events[ev] || 0) + 1
    outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1
  }

  return NextResponse.json({
    eventNames: events,
    outcomes,
    samples: (data || []).slice(0, 5).map((r: any) => ({
      at: r.created_at, outcome: r.outcome, detail: r.detail,
      phone: r.from_phone, text: r.body_text,
      raw: r.raw,
    })),
  })
}
