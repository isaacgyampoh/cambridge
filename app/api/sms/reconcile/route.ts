import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { reconcileDeliveries } from '@/lib/notifications/smsReconcile'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Ask the provider what became of the messages it accepted.
 *
 * Authenticated with the cron secret: the caller is the server itself, from
 * the dispatcher's task table. The path is in proxy.ts's CRON_PATHS for the
 * same reason every other scheduled task is — a self-call carries no session
 * cookie, and the middleware would otherwise answer it with "Please sign in
 * to continue" before the handler could check the secret, which is exactly
 * how the info-session worker spent a fortnight never running.
 */
async function handle(req: NextRequest) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await reconcileDeliveries()
  if ('error' in result) return NextResponse.json({ ran: false, ...result }, { status: 503 })
  return NextResponse.json({ ran: true, ...result })
}

export const GET = handle
export const POST = handle
