import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Shared links hub.
 * GET  — returns active links visible to the current user (audience-aware,
 *        not expired). Every worker can read.
 * POST — super admin/PM post a link (notifies everyone), or remove one.
 *        Body: { action:'post', title, url, link_type, description, audience, expires_at }
 *              { action:'remove', id }
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const now = new Date().toISOString()
  const { data } = await sb.from('shared_links')
    .select('*, poster:posted_by(full_name)')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  const isMarketer = session.role === 'marketing_officer'
  const links = (data || []).filter((l: any) => {
    if (l.expires_at && l.expires_at < now) return false
    if (l.audience === 'marketers') return isMarketer
    if (l.audience === 'staff') return !isMarketer
    return true // all
  })

  return NextResponse.json({ links })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid || !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const body = await req.json()
  const sb = createServiceClient()

  if (body.action === 'remove') {
    await sb.from('shared_links').update({ is_active: false }).eq('id', body.id)
    return NextResponse.json({ success: true })
  }

  if (body.action === 'post') {
    if (!body.title || !body.url) return NextResponse.json({ error: 'Title and URL required' }, { status: 400 })

    const { data: link, error } = await sb.from('shared_links').insert({
      title: body.title, url: body.url,
      link_type: body.link_type || 'general',
      description: body.description || null,
      audience: body.audience || 'all',
      expires_at: body.expires_at || null,
      batch_id: body.batch_id || null,
      posted_by: session.userId,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Notify the right audience
    let q = sb.from('profiles').select('id, role').eq('is_active', true).neq('role', 'student')
    const { data: people } = await q
    const targets = (people || []).filter((p: any) => {
      if (body.audience === 'marketers') return p.role === 'marketing_officer'
      if (body.audience === 'staff') return p.role !== 'marketing_officer'
      return true
    })
    if (targets.length) {
      await sb.from('notifications').insert(targets.map((p: any) => ({
        user_id: p.id, type: 'link',
        title: `New link: ${body.title}`,
        body: 'A new link is available in My Links.',
        link: p.role === 'marketing_officer' ? '/marketer/link' : '/links',
      }))).then(() => {}, () => {})
    }

    return NextResponse.json({ success: true, link, notified: targets.length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
