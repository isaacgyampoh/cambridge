import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

const ALLOWED = ['super_admin', 'project_manager', 'content_manager']

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !ALLOWED.includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const sb = createServiceClient()
  const { data } = await sb.from('content_posts').select('*').order('created_at', { ascending: false }).limit(200)
  return NextResponse.json({ posts: data || [] })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '', userId: '' }
  if (!session.valid || !ALLOWED.includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const body = await req.json()
  const sb = createServiceClient()

  if (body.action === 'delete') {
    await sb.from('content_posts').delete().eq('id', body.id)
    return NextResponse.json({ success: true })
  }

  const row: any = {
    title: body.title || null, body: body.body || null, platform: body.platform || null,
    hashtags: body.hashtags || null, media_url: body.media_url || null,
    status: body.status || 'draft', scheduled_for: body.scheduled_for || null,
    ai_notes: body.ai_notes || null, updated_at: new Date().toISOString(),
  }
  if (body.id) {
    await sb.from('content_posts').update(row).eq('id', body.id)
    return NextResponse.json({ success: true, id: body.id })
  } else {
    row.created_by = session.userId
    const { data, error } = await sb.from('content_posts').insert(row).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, id: data.id })
  }
}
