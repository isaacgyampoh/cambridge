import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'content_manager', 'project_manager']

async function guard(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  return (s.valid && ALLOWED.includes(s.role)) ? s : null
}

export async function GET(req: NextRequest) {
  const s = await guard(req); if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const sb = createServiceClient()
  const { data } = await sb.from('competitors').select('*').order('created_at', { ascending: false }).limit(100)
  return NextResponse.json({ competitors: data || [] })
}

export async function POST(req: NextRequest) {
  const s = await guard(req); if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const { name, handle, platform, notes } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  const sb = createServiceClient()
  const { data, error } = await sb.from('competitors').insert({
    name: name.trim(), handle: handle?.trim() || null, platform: platform || 'facebook',
    notes: notes?.trim() || null, added_by: s.userId,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ competitor: data })
}

export async function DELETE(req: NextRequest) {
  const s = await guard(req); if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const { id } = await req.json()
  const sb = createServiceClient()
  await sb.from('competitors').delete().eq('id', id)
  return NextResponse.json({ success: true })
}
