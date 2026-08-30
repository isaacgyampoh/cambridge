import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { processSmsQueue } from '@/lib/notifications/sms'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Retry every SMS that is due.
 *
 * Driven by the shared cron runner. Rows are claimed with SKIP LOCKED inside
 * claim_due_sms, so two overlapping runs take disjoint batches instead of both
 * sending the same message.
 */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await processSmsQueue(50)
  return NextResponse.json({ ok: true, ...result })
}
