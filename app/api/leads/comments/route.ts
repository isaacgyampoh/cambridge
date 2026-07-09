import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// GET ?lead_id=... -> list comments for a lead
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const leadId = new URL(req.url).searchParams.get('lead_id')
  if (!leadId) return NextResponse.json({ comments: [] })
  const sb = createServiceClient()
  const { data } = await sb.from('lead_comments').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(50)
  return NextResponse.json({ comments: data || [] })
}

// POST { lead_id, comment } -> add a comment + notify the PM(s) instantly
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { lead_id, comment } = await req.json()
  if (!lead_id || !comment?.trim()) return NextResponse.json({ error: 'A comment is required.' }, { status: 400 })

  const sb = createServiceClient()
  const { data: saved, error } = await sb.from('lead_comments').insert({
    lead_id, author_id: s.userId, author_name: s.fullName || 'A marketer', comment: comment.trim(),
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify PMs + admins immediately (in-app + SMS)
  const { data: lead } = await sb.from('leads').select('full_name').eq('id', lead_id).maybeSingle()
  const { data: mgrs } = await sb.from('profiles').select('id, phone, full_name').in('role', ['super_admin', 'project_manager']).eq('is_active', true).limit(10)
  const leadName = lead?.full_name || 'a lead'
  const note = {
    type: 'comment', title: 'Quick comment on a lead',
    body: `${s.fullName || 'A marketer'} on ${leadName}: "${comment.trim().slice(0, 90)}"`,
    link: `/pm/leads/${lead_id}`,
  }
  for (const m of mgrs || []) {
    await sb.from('notifications').insert({ user_id: m.id, ...note }).then(() => {}, () => {})
  }
  // SMS the PMs
  try {
    const { sendSMS } = await import('@/lib/integrations/sms')
    for (const m of mgrs || []) {
      if (m.phone) await sendSMS(m.phone, `Quick comment from ${(s.fullName || 'a marketer').split(' ')[0]} on ${leadName}: ${comment.trim().slice(0, 100)}. Check the portal.`)
    }
  } catch {}

  return NextResponse.json({ success: true, comment: saved })
}
