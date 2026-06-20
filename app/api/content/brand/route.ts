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
  const { data: profile } = await sb.from('brand_profile').select('*').limit(1).maybeSingle()
  const { data: assets } = await sb.from('brand_assets').select('*').order('created_at', { ascending: false }).limit(100)
  return NextResponse.json({ profile: profile || null, assets: assets || [] })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '', userId: '' }
  if (!session.valid || !ALLOWED.includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const body = await req.json()
  const sb = createServiceClient()

  if (body.action === 'add_asset') {
    if (!body.url) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    await sb.from('brand_assets').insert({ name: body.name || 'Asset', kind: body.kind || 'image', url: body.url, created_by: session.userId })
    return NextResponse.json({ success: true })
  }
  if (body.action === 'delete_asset') {
    await sb.from('brand_assets').delete().eq('id', body.id)
    return NextResponse.json({ success: true })
  }

  // Save the brand profile (upsert the single row)
  const fields = {
    voice: body.voice || null, tagline: body.tagline || null,
    do_say: body.do_say || null, dont_say: body.dont_say || null,
    primary_color: body.primary_color || null,
    updated_by: session.userId, updated_at: new Date().toISOString(),
  }
  const { data: existing } = await sb.from('brand_profile').select('id').limit(1).maybeSingle()
  if (existing) await sb.from('brand_profile').update(fields).eq('id', existing.id)
  else await sb.from('brand_profile').insert(fields)
  return NextResponse.json({ success: true })
}
