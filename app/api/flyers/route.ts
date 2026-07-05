import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const sb = createServiceClient()
  const { data } = await sb.from('flyers').select('*').eq('marketer_id', s.userId).order('created_at', { ascending: false }).limit(50)
  return NextResponse.json({ flyers: data || [] })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const { title, course, image_url } = await req.json()
  if (!image_url) return NextResponse.json({ error: 'Please upload a flyer image.' }, { status: 400 })
  const sb = createServiceClient()
  const { data, error } = await sb.from('flyers').insert({
    marketer_id: s.userId, title: title?.trim() || null, course: course || null, image_url,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ flyer: data })
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const { id } = await req.json()
  const sb = createServiceClient()
  await sb.from('flyers').delete().eq('id', id).eq('marketer_id', s.userId)  // only own
  return NextResponse.json({ success: true })
}
