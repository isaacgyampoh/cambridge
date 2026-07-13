import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

export const runtime = 'nodejs'
const COORD = ['super_admin', 'administrator', 'exam_coordinator']
const FINANCE = ['super_admin', 'administrator', 'accountant']

/**
 * Voucher workflow: coordinator REQUESTS -> finance FULFILS.
 *
 * GET  ?scope=finance  -> pending + recent requests (for the finance portal)
 * GET  (default)       -> this coordinator's requests
 * POST { action:'request', prep_record_id }               (coordinator)
 * POST { action:'fulfill', request_id, voucher_code, voucher_expiry_date }  (finance)
 * POST { action:'cancel', request_id }
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const scope = new URL(req.url).searchParams.get('scope')
  let q = sb.from('voucher_requests').select('*').order('requested_at', { ascending: false }).limit(200)
  if (scope !== 'finance') q = q.eq('requested_by', s.userId)
  const { data } = await q
  return NextResponse.json({ requests: data || [] })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const body = await req.json()
  const sb = createServiceClient()

  // ── Coordinator requests a voucher for a ready student ──
  if (body.action === 'request') {
    if (!COORD.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })
    const { data: rec } = await sb.from('prep_records').select('*').eq('id', body.prep_record_id).maybeSingle()
    if (!rec) return NextResponse.json({ error: 'Student not found.' }, { status: 404 })

    // Prevent duplicate open requests
    const { data: openReq } = await sb.from('voucher_requests')
      .select('id').eq('prep_record_id', rec.id).eq('status', 'pending').maybeSingle()
    if (openReq) return NextResponse.json({ error: 'A voucher request for this student is already pending.' }, { status: 400 })

    const { data: reqRow } = await sb.from('voucher_requests').insert({
      prep_record_id: rec.id, student_name: rec.student_name, phone: rec.phone, email: rec.email,
      program_code: rec.program_code, program_name: rec.program_name, requested_by: s.userId,
    }).select().single()

    // Notify finance staff (in-app + SMS)
    try {
      const { data: financeStaff } = await sb.from('profiles')
        .select('id, phone').eq('is_active', true).in('role', ['accountant', 'super_admin', 'administrator'])
      for (const f of financeStaff || []) {
        await sb.from('notifications').insert({
          user_id: f.id, type: 'voucher_request',
          title: 'Voucher requested',
          body: `${rec.student_name} (${rec.program_name || rec.program_code}) is ready to write — please buy & input their voucher.`,
          data: { request_id: reqRow?.id },
        }).then(() => {}, () => {})
        // SMS to accountants only (avoid spamming super admins)
      }
      // One SMS to the finance line(s)
      const smsTargets = (financeStaff || []).filter((f: any) => f.phone).slice(0, 3)
      for (const f of smsTargets) {
        try { await sendSMS(f.phone, `CCE: Voucher requested for ${rec.student_name} (${rec.program_name || rec.program_code}). Please buy and input it in the finance portal.`) } catch {}
      }
    } catch {}

    // Log on the prep record
    try { await sb.from('prep_activity').insert({ prep_record_id: rec.id, coordinator_id: s.userId, action: 'voucher_requested', detail: `Requested voucher for ${rec.student_name}` }) } catch {}
    return NextResponse.json({ success: true, request: reqRow })
  }

  // ── Finance fulfils: inputs the purchased voucher code ──
  if (body.action === 'fulfill') {
    if (!FINANCE.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })
    if (!body.voucher_code?.trim()) return NextResponse.json({ error: 'Voucher code is required.' }, { status: 400 })

    const { data: reqRow } = await sb.from('voucher_requests').select('*').eq('id', body.request_id).maybeSingle()
    if (!reqRow) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })

    // Assign to the student's prep record + mark request fulfilled
    await sb.from('prep_records').update({
      voucher_code: body.voucher_code.trim(),
      voucher_expiry_date: body.voucher_expiry_date || null,
      voucher_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', reqRow.prep_record_id)

    await sb.from('voucher_requests').update({
      status: 'fulfilled', voucher_code: body.voucher_code.trim(),
      voucher_expiry_date: body.voucher_expiry_date || null,
      fulfilled_by: s.userId, fulfilled_at: new Date().toISOString(),
    }).eq('id', reqRow.id)

    // Auto-send the voucher to the student on WhatsApp (SMS fallback)
    let messaged = false
    if (reqRow.phone) {
      const first = (reqRow.student_name || 'there').split(' ')[0]
      const expiry = body.voucher_expiry_date ? new Date(body.voucher_expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null
      const msg = `Hi ${first}! 🎓 Here is your ${reqRow.program_name || reqRow.program_code || 'exam'} voucher code:\n\n*${body.voucher_code.trim()}*\n${expiry ? `\nPlease note it expires on *${expiry}*, so schedule your exam before then.` : ''}\n\nWe'll keep sending you tips and reminders. Do your best — you've got this! 💪`
      try { messaged = !!(await sendWhatsAppText(reqRow.phone, msg)) } catch {}
      if (!messaged) { try { messaged = !!(await sendSMS(reqRow.phone, msg)) } catch {} }
    }

    // Notify the coordinator who requested it
    if (reqRow.requested_by) {
      await sb.from('notifications').insert({
        user_id: reqRow.requested_by, type: 'voucher_fulfilled',
        title: 'Voucher ready',
        body: `${reqRow.student_name}'s voucher has been purchased and sent to them.`,
        data: { prep_record_id: reqRow.prep_record_id },
      }).then(() => {}, () => {})
    }
    try { await sb.from('prep_activity').insert({ prep_record_id: reqRow.prep_record_id, coordinator_id: s.userId, action: 'voucher_sent', detail: `Voucher ${body.voucher_code.trim()} fulfilled by finance` }) } catch {}

    return NextResponse.json({ success: true, messaged })
  }

  if (body.action === 'cancel') {
    await sb.from('voucher_requests').update({ status: 'cancelled' }).eq('id', body.request_id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
