import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager', 'trainer']

/** PATCH — change a class. DELETE — remove one that has no students. */
export async function PATCH(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { batchId, ...fields } = await req.json().catch(() => ({}))
  if (!batchId) return NextResponse.json({ error: 'Which class?' }, { status: 400 })

  // Only these may be changed, so nothing unexpected can be written.
  const allowed = [
    'name', 'course_id', 'trainer_id', 'class_type', 'status',
    'start_date', 'end_date', 'schedule', 'venue', 'zoom_link',
    'max_students', 'free_sessions', 'min_payment_per_session',
    'next_session_at', 'total_sessions',
  ]
  const update: Record<string, any> = {}
  for (const k of allowed) if (k in fields) update[k] = fields[k] === '' ? null : fields[k]

  // A class cannot run online without somewhere for students to join.
  const sb = createServiceClient()
  if (update.status === 'ongoing') {
    const { data: current } = await sb.from('batches')
      .select('class_type, zoom_link').eq('id', batchId).maybeSingle()
    const type = update.class_type ?? current?.class_type
    const link = update.zoom_link ?? current?.zoom_link
    if (type === 'online' && !String(link || '').trim()) {
      return NextResponse.json({
        error: 'Add the Zoom link before starting an online class — students join through it.',
      }, { status: 400 })
    }
  }

  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  update.updated_at = new Date().toISOString()

  const { error } = await sb.from('batches').update(update).eq('id', batchId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !['super_admin', 'administrator'].includes(s.role)) {
    return NextResponse.json({ error: 'unauth' }, { status: 401 })
  }

  const batchId = new URL(req.url).searchParams.get('batchId')
  if (!batchId) return NextResponse.json({ error: 'Which class?' }, { status: 400 })

  const sb = createServiceClient()
  const { count } = await sb.from('class_enrollments')
    .select('id', { count: 'exact', head: true }).eq('batch_id', batchId)

  if (count && count > 0) {
    return NextResponse.json({
      error: `${count} student${count === 1 ? ' is' : 's are'} in this class. Move them first, or mark the class cancelled instead of deleting it.`,
    }, { status: 409 })
  }

  await sb.from('class_sessions').delete().eq('batch_id', batchId).then(() => {}, () => {})
  const { error } = await sb.from('batches').delete().eq('id', batchId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
