import { NextRequest, NextResponse } from 'next/server'
import { PIN_PATTERN, PIN_LENGTH, pinRejectionReason } from '@/lib/auth/pinPolicy'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, verifyPIN, getSessionFromCookies } from '@/lib/auth/pin'
import { rateLimit, retryMessage } from '@/lib/auth/rateLimit'
import { recordAudit } from '@/lib/audit'
import { z } from 'zod'

export const runtime = 'nodejs'

const Body = z.object({
  currentPin: z.string().regex(PIN_PATTERN).optional(),
  newPin: z.string().regex(PIN_PATTERN, `Your new PIN must be exactly ${PIN_LENGTH} digits`),
})

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session.valid || !session.userId) {
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Enter a valid new PIN.' },
      { status: 400 }
    )
  }
  const { currentPin, newPin } = parsed.data

  const weak = pinRejectionReason(newPin)
  if (weak) return NextResponse.json({ error: weak }, { status: 400 })

  const limit = await rateLimit(`changepin:${session.userId}`, 10, 15 * 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json({ error: `Too many attempts. ${retryMessage(limit.retryAfter)}` }, { status: 429 })
  }

  const sb = createServiceClient()
  const { data: profile } = await sb.from('profiles')
    .select('pin_hash, must_change_pin').eq('id', session.userId).maybeSingle()

  if (!profile) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })

  /*
   * The old code read:
   *
   *     if (!profile?.must_change_pin && currentPin) { ...verify... }
   *
   * so simply OMITTING currentPin skipped the check altogether — anyone with a
   * stolen session cookie could set a new PIN without knowing the old one and
   * take the account permanently. The current PIN is now required whenever the
   * account is not in the forced-reset state, and its absence is a refusal.
   */
  if (!profile.must_change_pin) {
    if (!currentPin) {
      return NextResponse.json({ error: 'Enter your current PIN to change it.' }, { status: 400 })
    }
    const { ok } = await verifyPIN(currentPin, profile.pin_hash || '')
    if (!ok) {
      return NextResponse.json({ error: 'Your current PIN is not correct.' }, { status: 401 })
    }
    if (currentPin === newPin) {
      return NextResponse.json({ error: 'Your new PIN must be different from your current one.' }, { status: 400 })
    }
  }

  const { error } = await sb.from('profiles').update({
    pin_hash: await hashPIN(newPin),
    pin_set_at: new Date().toISOString(),
    must_change_pin: false,
    login_attempts: 0,
    locked_until: null,
  }).eq('id', session.userId)

  if (error) {
    console.error('[change-pin] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save your new PIN. Please try again.' }, { status: 500 })
  }

  await recordAudit({
    actorId: session.userId,
    action: 'pin.changed',
    resource: 'profiles',
    resourceId: session.userId,
    success: true,
    request: req,
  })

  return NextResponse.json({ success: true, message: 'Your PIN has been changed.' })
}
