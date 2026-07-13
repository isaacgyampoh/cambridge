import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'exam_coordinator']

async function guard(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return null
  return s
}

// GET ?program_code=PMP -> list content for a programme
export async function GET(req: NextRequest) {
  const s = await guard(req); if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const prog = new URL(req.url).searchParams.get('program_code')
  const sb = createServiceClient()
  let q = sb.from('prep_content').select('*').eq('active', true).order('created_at', { ascending: false })
  if (prog) q = q.eq('program_code', prog)
  const { data } = await q
  return NextResponse.json({ content: data || [] })
}

// POST { action: 'create'|'delete'|'send', ... }
export async function POST(req: NextRequest) {
  const s = await guard(req); if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const body = await req.json()
  const sb = createServiceClient()

  if (body.action === 'create') {
    const { program_code, kind, title, content, answer, send_offset_days } = body
    if (!program_code || !kind || !content?.trim()) return NextResponse.json({ error: 'Programme, type and content are required.' }, { status: 400 })
    const { data, error } = await sb.from('prep_content').insert({
      program_code, kind, title: title || null, body: content.trim(),
      answer: answer || null, send_offset_days: send_offset_days ?? null,
      created_by: s.userId,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, content: data })
  }

  if (body.action === 'delete') {
    await sb.from('prep_content').update({ active: false }).eq('id', body.id)
    return NextResponse.json({ success: true })
  }

  // Manual send: blast a piece of content to all active-prep students in its programme
  if (body.action === 'send') {
    const { data: content } = await sb.from('prep_content').select('*').eq('id', body.id).maybeSingle()
    if (!content) return NextResponse.json({ error: 'Content not found.' }, { status: 404 })

    const { data: students } = await sb.from('prep_records')
      .select('id, student_name, phone, program_code, prep_status')
      .eq('program_code', content.program_code).neq('prep_status', 'completed')
    let sent = 0
    for (const st of students || []) {
      if (!st.phone) continue
      const first = (st.student_name || 'there').split(' ')[0]
      const msg = formatContent(content, first)
      let ok = false
      try { ok = !!(await sendWhatsAppText(st.phone, msg)) } catch {}
      if (!ok) { try { ok = !!(await sendSMS(st.phone, msg)) } catch {} }
      if (ok) {
        sent++
        await sb.from('prep_sends').insert({ content_id: content.id, prep_record_id: st.id, phone: st.phone }).then(() => {}, () => {})
      }
    }
    return NextResponse.json({ success: true, sent, total: (students || []).length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

function formatContent(c: any, firstName: string): string {
  const hi = `Hi ${firstName}! `
  if (c.kind === 'question') {
    return `${hi}📝 Practice question:\n\n${c.body}${c.answer ? `\n\n*Answer:* ${c.answer}` : ''}`
  }
  if (c.kind === 'tip') return `${hi}💡 Exam tip:\n\n${c.body}`
  if (c.kind === 'exam_info') return `${hi}ℹ️ ${c.title || 'Exam information'}:\n\n${c.body}`
  if (c.kind === 'encouragement') return `${hi}${c.body}`
  return `${hi}${c.body}`
}
