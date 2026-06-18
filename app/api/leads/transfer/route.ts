import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Lead ownership conflict resolution.
 * GET  — pending transfer requests (PM/admin see all; marketer sees own).
 * POST — action: 'request' (marketer asks for a lead),
 *                'approve' | 'decline' (PM/admin decides).
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '', userId: '' }
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const isPriv = ['super_admin', 'project_manager'].includes(session.role || '')

  let q = sb.from('lead_transfer_requests')
    .select('*, lead:lead_id(full_name, phone, course_interest), requester:requested_by(full_name), owner:current_owner(full_name)')
    .order('created_at', { ascending: false })
  if (!isPriv) q = q.eq('requested_by', session.userId!)
  const { data } = await q
  return NextResponse.json({ requests: data || [] })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '', userId: '' }
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const sb = createServiceClient()

  // ── Marketer looks up a lead by phone (to request it) ──
  if (body.action === 'lookup') {
    if (session.role !== 'marketing_officer') {
      return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
    }
    const norm = (body.phone || '').replace(/^0/, '233').replace(/\D/g, '')
    if (!norm) return NextResponse.json({ error: 'Enter a phone number' }, { status: 400 })
    const { data: lead } = await sb.from('leads')
      .select('id, full_name, phone, assigned_to, assignee:assigned_to(full_name)')
      .eq('phone', norm).maybeSingle()
    if (!lead) return NextResponse.json({ found: false })
    return NextResponse.json({
      found: true,
      lead: {
        id: lead.id, full_name: lead.full_name,
        assigned_to: lead.assigned_to,
        owner_name: (lead as any).assignee?.full_name || null,
        mine: lead.assigned_to === session.userId,
      },
    })
  }

  // ── Marketer requests a transfer ──
  if (body.action === 'request') {
    if (session.role !== 'marketing_officer') {
      return NextResponse.json({ error: 'Only marketers request transfers' }, { status: 403 })
    }
    const { leadId, reason } = body
    if (!leadId) return NextResponse.json({ error: 'Missing lead' }, { status: 400 })

    const { data: lead } = await sb.from('leads').select('id, assigned_to, full_name').eq('id', leadId).maybeSingle()
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (lead.assigned_to === session.userId) {
      return NextResponse.json({ error: 'This lead is already yours' }, { status: 400 })
    }

    // Avoid duplicate pending requests by the same marketer for the same lead
    const { data: existing } = await sb.from('lead_transfer_requests')
      .select('id').eq('lead_id', leadId).eq('requested_by', session.userId!).eq('status', 'pending').maybeSingle()
    if (existing) return NextResponse.json({ error: 'You already have a pending request for this lead' }, { status: 400 })

    const { data: tr } = await sb.from('lead_transfer_requests').insert({
      lead_id: leadId, requested_by: session.userId, current_owner: lead.assigned_to, reason: reason || null,
    }).select().single()

    // Notify the PMs / super admins
    const { data: approvers } = await sb.from('profiles').select('id').in('role', ['super_admin', 'project_manager']).eq('is_active', true)
    if (approvers?.length) {
      await sb.from('notifications').insert(approvers.map((a: any) => ({
        user_id: a.id, type: 'transfer',
        title: 'Lead transfer request',
        body: `A marketer is requesting ${lead.full_name}. Review and decide.`,
        link: '/admin/transfers',
      }))).then(() => {}, () => {})
    }
    return NextResponse.json({ success: true, request: tr })
  }

  // ── PM/admin decides ──
  if (body.action === 'approve' || body.action === 'decline') {
    if (!['super_admin', 'project_manager'].includes(session.role || '')) {
      return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
    }
    const { requestId, note } = body
    const { data: tr } = await sb.from('lead_transfer_requests').select('*').eq('id', requestId).maybeSingle()
    if (!tr || tr.status !== 'pending') return NextResponse.json({ error: 'Request not found or already decided' }, { status: 400 })

    await sb.from('lead_transfer_requests').update({
      status: body.action === 'approve' ? 'approved' : 'declined',
      decided_by: session.userId, decided_at: new Date().toISOString(), decision_note: note || null,
    }).eq('id', requestId)

    if (body.action === 'approve') {
      // Reassign the lead to the requester + log it
      await sb.from('leads').update({ assigned_to: tr.requested_by }).eq('id', tr.lead_id)
      await sb.from('lead_activities').insert({
        lead_id: tr.lead_id, type: 'transfer',
        note: `Lead ownership transferred${note ? `: ${note}` : '.'}`,
        created_by: session.userId,
      }).then(() => {}, () => {})
    }

    // Notify the requester of the outcome
    await sb.from('notifications').insert({
      user_id: tr.requested_by, type: 'transfer',
      title: `Transfer ${body.action === 'approve' ? 'approved' : 'declined'}`,
      body: body.action === 'approve' ? 'The lead is now assigned to you.' : 'Your transfer request was declined.',
      link: '/marketer',
    }).then(() => {}, () => {})

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
