import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'project_manager', 'trainer']

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { batch_id, class_at, note } = await req.json()
  if (!batch_id) return NextResponse.json({ studentCount: 0, message: '' })

  const sb = createServiceClient()
  const [{ count }, { data: batch }] = await Promise.all([
    sb.from('class_enrollments').select('id', { count: 'exact', head: true }).eq('batch_id', batch_id).not('phone', 'is', null),
    sb.from('batches').select('name, zoom_link').eq('id', batch_id).maybeSingle(),
  ])

  const when = class_at ? new Date(class_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '[class time]'
  const message = `Hi [name], reminder: your ${batch?.name || '[class]'} class is on ${when}.\nJoin here: ${batch?.zoom_link || '[no Zoom link set]'}${note ? `\n${note}` : ''}`

  return NextResponse.json({ studentCount: count || 0, hasLink: !!batch?.zoom_link, message })
}
