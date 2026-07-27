import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { renderPersonalisedDoc } from '@/lib/documentFill'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager', 'accountant', 'admissions_officer', 'exam_coordinator', 'trainer']

/**
 * Preview a template filled with sample data, so positions can be adjusted
 * before any real student receives it.
 * Body: { documentId, positions? }  — positions override what's saved.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { documentId, positions } = await req.json().catch(() => ({}))
  if (!documentId) return NextResponse.json({ error: 'Missing document' }, { status: 400 })

  const sb = createServiceClient()
  const { data: doc } = await sb.from('documents')
    .select('file_url, field_positions, name').eq('id', documentId).maybeSingle()
  if (!doc?.file_url) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  // Save any adjusted positions so the next send uses them
  if (positions) {
    await sb.from('documents').update({ field_positions: positions }).eq('id', documentId).then(() => {}, () => {})
  }

  const url = await renderPersonalisedDoc({
    templateUrl: doc.file_url,
    positions: positions || doc.field_positions || null,
    folder: 'previews',
    filename: 'preview',
    values: {
      full_name: 'Kwame Boateng',
      admission_number: 'CCE/2026/0042',
      course: 'Projects Management Professional (PMP)',
      batch: 'March Cohort',
      date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      amount: 'GHS 3,950.00',
      email: 'kwame@example.com',
      phone: '0241234567',
      receipt_number: 'RCP-10231',
    },
  })

  if (!url) return NextResponse.json({ error: 'Could not generate the preview. Make sure the file is a PDF.' }, { status: 500 })
  return NextResponse.json({ success: true, url })
}
