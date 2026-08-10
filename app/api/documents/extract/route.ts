import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * Pull the text out of an uploaded chat sample, once, and store it.
 * Doing this at upload rather than per message means a PDF costs nothing when
 * the assistant is actually replying to someone.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { documentId } = await req.json().catch(() => ({}))
  if (!documentId) return NextResponse.json({ error: 'Missing document' }, { status: 400 })

  const sb = createServiceClient()
  const { data: doc } = await sb.from('documents')
    .select('id, file_url, file_name, name').eq('id', documentId).maybeSingle()
  if (!doc?.file_url) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  let text = ''
  try {
    const res = await fetch(doc.file_url, { signal: AbortSignal.timeout(20000) })
    const isPdf = /\.pdf$/i.test(doc.file_name || doc.file_url) ||
      /pdf/i.test(res.headers.get('content-type') || '')

    if (isPdf) {
      const buf = Buffer.from(await res.arrayBuffer())
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: new Uint8Array(buf) })
      const parsed = await parser.getText()
      text = String(parsed?.text || '')
    } else {
      text = await res.text()
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Could not read that file: ${e?.message || e}` }, { status: 400 })
  }

  text = text.replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000)
  if (!text) return NextResponse.json({ error: 'No readable text found. If it is a scanned image, type the conversation into a text file instead.' }, { status: 400 })

  await sb.from('documents').update({ extracted_text: text }).eq('id', documentId)
  return NextResponse.json({ success: true, characters: text.length, preview: text.slice(0, 200) })
}
