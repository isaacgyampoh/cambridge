import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifySession } from '@/lib/auth/pin'
import { prepareAdmissionLetter, issueAdmissionLetter } from '@/lib/admissions/letter'
import { ADMISSIONS_ROLES } from '@/lib/admissions/letterPolicy'

export const runtime = 'nodejs'

/**
 * Review and send an admission letter — manually, and only manually.
 *
 *   GET  ?admissionId=…                       what the letter will say
 *   POST { admissionId, action: 'review' }    build the PDF to read; sends nothing
 *   POST { admissionId, action: 'send', confirm: true, resend? }
 *
 * `confirm: true` is required to send, so no caller can send by omission, and
 * `resend: true` is required when a letter has already gone.
 */

async function guard(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: { valid?: boolean; role?: string; userId?: string } =
    token ? await verifySession(token) : { valid: false }
  if (!s.valid) return { error: NextResponse.json({ error: 'Please sign in to continue.' }, { status: 401 }) }
  if (!ADMISSIONS_ROLES.includes(s.role || '')) {
    return { error: NextResponse.json(
      { error: 'Only the Admissions department can send admission letters.' }, { status: 403 }) }
  }
  return { session: s }
}

export async function GET(req: NextRequest) {
  const g = await guard(req)
  if ('error' in g) return g.error

  const admissionId = req.nextUrl.searchParams.get('admissionId')
  if (!admissionId) return NextResponse.json({ error: 'Which admission?' }, { status: 400 })

  const result = await prepareAdmissionLetter(admissionId)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status })
  return NextResponse.json({ preview: result.preview })
}

const Body = z.object({
  admissionId: z.string().uuid('That admission reference is not valid.'),
  action: z.enum(['review', 'send']),
  confirm: z.boolean().optional(),
  resend: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const g = await guard(req)
  if ('error' in g) return g.error

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'That request could not be read.' }, { status: 400 })
  }
  const { admissionId, action, confirm, resend } = parsed.data

  if (action === 'send' && confirm !== true) {
    return NextResponse.json(
      { error: 'Sending an admission letter must be confirmed.' }, { status: 400 })
  }

  const result = await issueAdmissionLetter(admissionId, g.session.userId as string, {
    review: action === 'review',
    resend: resend === true,
  })

  if (!result.ok) {
    return NextResponse.json({
      error: result.reason,
      needsResendConfirmation: result.needsResendConfirmation ?? false,
      preview: result.preview ?? null,
    }, { status: result.status })
  }

  return NextResponse.json({
    success: true,
    sent: action === 'send',
    pdfUrl: result.pdfUrl,
    recorded: result.recorded,
    preview: result.preview,
  })
}
