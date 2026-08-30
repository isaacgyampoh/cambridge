import { NextRequest, NextResponse } from 'next/server'
import { completeApplication } from '@/lib/registration/complete'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Complete a registration after the fee is paid.
 *
 * The work now lives in lib/registration/complete.ts so the payment webhook
 * can call it directly instead of issuing an HTTP request from the deployment
 * back to its own origin — a round trip that could fail or time out on its
 * own, leaving a paid application half-processed.
 *
 * This endpoint remains for the browser return page. Both callers race for the
 * same claim inside completeApplication, and exactly one does the work.
 */
const Body = z.object({
  applicationId: z.string().uuid('That registration reference is not valid.'),
  paystack_ref: z.string().max(120).optional().nullable(),
})

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid request.' },
      { status: 400 }
    )
  }

  try {
    const result = await completeApplication(parsed.data.applicationId, parsed.data.paystack_ref)

    if (!result.ok) {
      console.error('[applications/complete]', result.reason)
      return NextResponse.json(
        { error: 'We could not finish your registration. Our team has been notified.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      alreadyProcessed: result.alreadyProcessed ?? false,
      admissionNumber: result.admissionNumber ?? null,
    })
  } catch (e) {
    console.error('[applications/complete] threw:', e)
    return NextResponse.json(
      { error: 'We could not finish your registration. Our team has been notified.' },
      { status: 500 }
    )
  }
}
