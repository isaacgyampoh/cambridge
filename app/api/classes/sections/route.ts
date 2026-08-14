import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager', 'trainer']

/** GET  ?batchId=   — the sections of a class. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const batchId = new URL(req.url).searchParams.get('batchId')
  if (!batchId) return NextResponse.json({ error: 'Which class?' }, { status: 400 })

  const sb = createServiceClient()
  const { data } = await sb.from('class_sections')
    .select('*').eq('batch_id', batchId).order('section_no')
  return NextResponse.json({ sections: data || [] })
}

/** POST — add or update a section, or mark it the one the class is on now. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { batchId, sectionNo, title, zoomLink, scheduledAt, makeCurrent } = await req.json().catch(() => ({}))
  if (!batchId || !sectionNo) return NextResponse.json({ error: 'Which class and section?' }, { status: 400 })

  const sb = createServiceClient()
  await sb.from('class_sections').upsert({
    batch_id: batchId,
    section_no: Number(sectionNo),
    title: title || `Section ${sectionNo}`,
    zoom_link: zoomLink?.trim() || null,
    scheduled_at: scheduledAt || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'batch_id,section_no' })

  if (makeCurrent) {
    // Only one section can be the current one.
    await sb.from('class_sections').update({ is_current: false }).eq('batch_id', batchId)
    await sb.from('class_sections').update({ is_current: true })
      .eq('batch_id', batchId).eq('section_no', Number(sectionNo))
    await sb.from('batches').update({ current_section: Number(sectionNo) }).eq('id', batchId)

    // The class's own link follows the current section, so anything still
    // reading the old field stays correct.
    if (zoomLink?.trim()) {
      await sb.from('batches').update({ zoom_link: zoomLink.trim() }).eq('id', batchId)
    }
  }

  return NextResponse.json({ success: true })
}

/** DELETE ?batchId=&sectionNo= */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const u = new URL(req.url)
  const batchId = u.searchParams.get('batchId')
  const sectionNo = u.searchParams.get('sectionNo')
  if (!batchId || !sectionNo) return NextResponse.json({ error: 'Which section?' }, { status: 400 })

  const sb = createServiceClient()
  await sb.from('class_sections').delete().eq('batch_id', batchId).eq('section_no', Number(sectionNo))
  return NextResponse.json({ success: true })
}
