import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { documentId, studentIds } = await req.json()
  if (!documentId || !studentIds?.length) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const sb = createServiceClient()

  const [{ data: doc }, { data: students }] = await Promise.all([
    sb.from('documents').select('*').eq('id', documentId).single(),
    sb.from('profiles').select('*').in('id', studentIds),
  ])

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Email not configured' }, { status: 500 })

  let sent = 0
  for (const student of students || []) {
    if (!student.email) continue

    // Send email with PDF link
    const subject = `${doc.name} — Cambridge Centre of Excellence`
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <div style="background:#1e3a8a;padding:30px;border-radius:12px 12px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:22px">Cambridge Centre of Excellence</h1>
        </div>
        <div style="background:white;padding:30px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
          <p style="color:#374151">Dear <strong>${student.full_name}</strong>,</p>
          <p style="color:#6b7280">Please find your <strong>${doc.name}</strong> attached via the link below:</p>
          <div style="text-align:center;margin:25px 0">
            <a href="${doc.file_url}" style="background:#1e3a8a;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
              📄 View / Download Document
            </a>
          </div>
          ${doc.description ? `<p style="color:#6b7280;font-size:14px">${doc.description}</p>` : ''}
          <p style="color:#374151;margin-top:30px">Best regards,<br><strong>Cambridge Centre of Excellence</strong></p>
        </div>
      </div>
    `

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || 'Cambridge CE <noreply@cambridge.edu.gh>',
          to: student.email,
          subject,
          html,
        }),
      })

      await sb.from('email_logs').insert({
        recipient: student.email,
        subject,
        template: doc.type,
        status: 'sent',
      })

      sent++
    } catch (e) {
      console.error('[Documents] Email error:', e)
    }
  }

  return NextResponse.json({ success: true, sent })
}
