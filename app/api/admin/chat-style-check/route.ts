import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * Is the uploaded conversation sample actually being read? Shows what was
 * extracted, so a file that produced nothing is obvious rather than silently
 * ignored.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data } = await sb.from('documents')
    .select('id, name, file_name, extracted_text, created_at')
    .eq('type', 'chat_sample').order('created_at', { ascending: false }).limit(10)

  const samples = (data || []).map((d: any) => ({
    name: d.name,
    file: d.file_name,
    characters: d.extracted_text ? d.extracted_text.length : 0,
    beingUsed: !!d.extracted_text,
    preview: d.extracted_text ? String(d.extracted_text).slice(0, 300) : null,
    id: d.id,
  }))

  const unread = samples.filter(x => !x.beingUsed)
  return NextResponse.json({
    total: samples.length,
    beingUsed: samples.filter(x => x.beingUsed).length,
    samples,
    advice: samples.length === 0
      ? 'No chat samples uploaded yet. Upload one in Documents with type "Chat Sample".'
      : unread.length
        ? `${unread.length} sample(s) have no readable text — likely scanned images. Use "Re-read" on them, or paste the conversation into a text file instead.`
        : 'All samples are being used to shape how the assistant writes.',
  })
}

/** Re-run extraction on a sample that produced nothing first time. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { documentId } = await req.json().catch(() => ({}))
  const origin = new URL(req.url).origin
  const r = await fetch(`${origin}/api/documents/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') || '' },
    body: JSON.stringify({ documentId }),
  })
  return NextResponse.json(await r.json())
}
