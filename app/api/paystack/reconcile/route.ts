import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'accountant']

/**
 * Cron sweep (hourly): /api/paystack/reconcile?key=SECRET
 * Auto-fixes any paid-but-unprocessed application (webhook missed, browser
 * closed) — assignment, credit, registered status, admission letter.
 */
export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get('key') !== CONFIG.setupSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const origin = new URL(req.url).origin
  const result = await sweep(origin)
  return NextResponse.json({ ran: true, ...result })
}

/**
 * Reconcile stuck payments: finds applications that were paid on Paystack but
 * never fully processed (lead unassigned, marketer not credited, status not
 * registered), verifies each against Paystack, and completes them.
 *
 * Fixes cases where the webhook failed / wasn't configured. Admin/finance only.
 * Optional body { reference } to fix ONE specific transaction by its Paystack ref.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const sb = createServiceClient()
  const origin = new URL(req.url).origin
  const results: any[] = []

  // Mode 1: fix one specific reference (finance pastes the Paystack ref)
  if (body.reference) {
    const r = await verifyAndComplete(body.reference, origin)
    return NextResponse.json({ fixed: r.ok ? 1 : 0, detail: r })
  }

  const s2 = await sweep(origin)
  return NextResponse.json(s2)
}

async function sweep(origin: string) {
  const sb = createServiceClient()
  const results: any[] = []
  // Find paid-but-unprocessed applications: lead missing, not registered, or
  // (a link payment) still unassigned — then verify + complete each.
  const { data: apps } = await sb.from('applications')
    .select('id, paystack_ref, payment_status, lead_id, marketer_id, full_name')
    .not('paystack_ref', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200)

  for (const app of apps || []) {
    let needsFix = false
    if (app.lead_id) {
      const { data: lead } = await sb.from('leads').select('status, assigned_to').eq('id', app.lead_id).maybeSingle()
      if (!lead || lead.status !== 'registered') needsFix = true
      else if (app.marketer_id && lead.assigned_to !== app.marketer_id) needsFix = true
    } else {
      needsFix = true
    }
    if (!needsFix) continue
    if (app.paystack_ref) {
      const r = await verifyAndComplete(app.paystack_ref, origin)
      results.push({ application: app.full_name, ...r })
    }
  }
  return { swept: (apps || []).length, fixed: results.filter(r => r.ok).length, results }
}

async function verifyAndComplete(reference: string, origin: string) {
  try {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${CONFIG.paystackSecretKey}` },
    })
    const data = await res.json()
    if (!data.status || data.data?.status !== 'success') return { ok: false, reference, reason: 'not successful on Paystack' }
    const applicationId = data.data?.metadata?.application_id
      || (reference.startsWith('CCE-APP-') ? reference.slice('CCE-APP-'.length).replace(/-\d+$/, '') : null)
    if (!applicationId) return { ok: false, reference, reason: 'no application id' }
    await fetch(`${origin}/api/applications/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId, paystack_ref: reference }),
    })
    return { ok: true, reference, applicationId }
  } catch (e: any) {
    return { ok: false, reference, reason: e?.message || 'error' }
  }
}
