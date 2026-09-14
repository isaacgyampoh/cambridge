import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit, clientIp } from '@/lib/auth/rateLimit'
import { intakeLead } from '@/lib/leadIntake'
import { loadMarketerByCode } from '@/lib/marketing/link'

export const runtime = 'nodejs'

/**
 * "Tell me more about this programme."
 *
 * ── THE HALF OF A CAMPAIGN THAT WAS MISSING ────────────────────────────────
 *
 * The marketing page could only send somebody into registration, which is the
 * right action for a person who has already decided. Most people opening a
 * link from WhatsApp have not. They want to know when it starts, or whether
 * they can pay in instalments, and being shown a payment form is how you lose
 * them — so the campaign produced nothing from everybody who was merely
 * interested.
 *
 * This is the other action: a name, a number, and the programme they were
 * looking at, which becomes a lead the marketer can ring.
 *
 * ── IT CREATES NOTHING OF ITS OWN ──────────────────────────────────────────
 *
 * intakeLead is the shared funnel every other inbound lead goes through:
 * phone canonicalisation, de-duplication against every stored spelling of the
 * number, assignment, the marketer's notification, the pending-SMS counter.
 * None of that is repeated here. The only thing this endpoint decides is WHO
 * the lead belongs to, and the URL already answered that.
 *
 * ── ATTRIBUTION ────────────────────────────────────────────────────────────
 *
 * `preferredMarketerId` is the owner of the link that was opened, resolved
 * server-side from the code in the path — never taken from the request body,
 * which anybody could set. autoAssignLead honours it for a new lead and, for
 * somebody who already exists, leaves their current owner alone. That is the
 * correct rule: an enquiry through Ada's link should not take a lead off the
 * colleague who has been working them for a month.
 */

const Body = z.object({
  /** The marketing link this came from. Decides the owner. */
  code: z.string().trim().min(1).max(100),
  full_name: z.string().trim().min(2, 'Please enter your name').max(120),
  phone: z.string().trim().min(6, 'Please enter your phone number').max(30),
  /** What they were looking at. Stored as their interest. */
  programme: z.string().trim().max(200).optional().nullable(),
  message: z.string().trim().max(1000).optional().nullable(),
})

export async function POST(req: NextRequest) {
  let parsed
  try {
    parsed = Body.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Please check the form and try again.' }, { status: 400 })
  }
  if (!parsed.success) {
    // The first real complaint, in the words the person needs — not a schema dump.
    const first = parsed.error.issues[0]
    return NextResponse.json({ error: first?.message || 'Please check the form and try again.' }, { status: 400 })
  }

  const { code, full_name, phone, programme, message } = parsed.data

  /*
   * A public form that writes a lead and sends a WhatsApp message to the
   * number in the body. Bounded, for the same reasons as the lead webhooks.
   */
  const limit = await rateLimit(`marketing_enquiry:${clientIp(req)}`, 8, 3600, 3600)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many enquiries from this device. Please try again later, or call us.' },
      { status: 429 },
    )
  }

  // Resolve the owner from the link, server-side. A deactivated member of
  // staff resolves to null, which sends the lead to the ordinary rules rather
  // than to somebody who has left.
  const marketer = await loadMarketerByCode(code)

  const created = await intakeLead({
    full_name,
    phone,
    source: 'referral',
    course_interest: programme || null,
    landing_source: 'Staff marketing link',
    utm_source: 'marketing_link',
    utm_medium: 'staff_link',
    utm_campaign: programme || null,
    utm_content: code,
    preferredMarketerId: marketer ? await ownerIdFor(code) : null,
    // Their question, kept where the marketer will read it before ringing.
    extra: message ? { notes: message } : undefined,
  })

  if (!created.leadId) {
    /*
     * intakeLead fails closed when it cannot check for a duplicate. Saying
     * "thank you, we'll be in touch" to that would be a promise nobody is
     * able to keep — there is no lead for anyone to ring.
     */
    return NextResponse.json(
      { error: 'We could not record your details just now. Please try again in a moment.' },
      { status: 503 },
    )
  }

  /*
   * No ids, no assignment details, no whether-they-already-existed. The page
   * needs to know it worked and who will call; everything else is internal.
   */
  return NextResponse.json({
    success: true,
    contactName: marketer?.name ?? null,
  })
}

/**
 * The owner's id, for assignment.
 *
 * Separate from loadMarketerByCode because that function deliberately does not
 * select the profile id — it feeds a public page, and an internal identifier
 * has no business being rendered into one. Assignment genuinely needs it, so
 * it is read here, server-side, and never returned to the caller.
 */
async function ownerIdFor(code: string): Promise<string | null> {
  const { createServiceClient } = await import('@/lib/supabase/server')
  const { lookup } = await import('@/lib/db/lookup')

  const { row, failed } = await lookup(
    createServiceClient()
      .from('profiles')
      .select('id, is_active')
      .eq('marketer_code', code)
      .maybeSingle(),
  )
  if (failed) {
    // Fall through to the ordinary assignment rules rather than lose the
    // enquiry — but say so, because this lead is about to be credited to
    // somebody other than the person whose link produced it.
    console.error('[marketing/enquire] could not resolve the link owner:', failed)
    return null
  }
  if (!row || row.is_active === false) return null
  return row.id as string
}
