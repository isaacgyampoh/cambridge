import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { canonicalPhone, phoneVariants } from '@/lib/leads/importValidation'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * Which of these people are already on file?
 *
 * ── WHY THE PREVIEW ASKS BEFORE THE IMPORT RUNS ────────────────────────────
 *
 * The importer has always skipped duplicates, and said so afterwards: "40
 * received, 31 duplicates". By then the operator has no idea WHICH thirty-one,
 * or whether the list they paid for was nine new names or a mistake in the
 * file. Asking first turns that into something they can see and decide about
 * while there is still a decision to make.
 *
 * Nothing is written here. This is a read, and the import's own duplicate
 * check still runs — two people can be imported in the seconds between this
 * answer and that one, and only the check inside the write can be the
 * authority.
 */

const Body = z.object({
  contacts: z.array(z.object({
    phone: z.string().trim().max(40).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
  })).min(1).max(500),
})

export const POST = withGuard({ portals: ['leads', 'pm_leads'] }, async (req: NextRequest) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'That list could not be read.' }, { status: 400 })
  }
  const { contacts } = parsed.data

  /*
   * Every spelling of every number in one query, rather than a query per row.
   * Five hundred rows was five hundred round trips, which is how a preview
   * becomes slower than the import it is previewing.
   */
  const allVariants = new Set<string>()
  const allEmails = new Set<string>()
  for (const c of contacts) {
    for (const v of phoneVariants(c.phone)) allVariants.add(v)
    const email = String(c.email || '').trim().toLowerCase()
    if (email) allEmails.add(email)
  }

  const sb = createServiceClient()
  const existingPhones = new Set<string>()
  const existingEmails = new Set<string>()

  try {
    if (allVariants.size) {
      const { data, error } = await sb.from('leads')
        .select('phone').in('phone', [...allVariants].slice(0, 2000))
      if (error) throw new Error(error.message)
      for (const row of data || []) {
        for (const v of phoneVariants(row.phone as string)) existingPhones.add(v)
      }
    }
    if (allEmails.size) {
      const { data, error } = await sb.from('leads')
        .select('email').in('email', [...allEmails].slice(0, 2000))
      if (error) throw new Error(error.message)
      for (const row of data || []) {
        const e = String(row.email || '').trim().toLowerCase()
        if (e) existingEmails.add(e)
      }
    }
  } catch (e) {
    /*
     * A failed read must not come back as "none of these are duplicates".
     * That is the answer that makes an operator import a list they would
     * otherwise have stopped to look at.
     */
    console.error('[leads/import/check]', e)
    return NextResponse.json(
      { error: 'Existing leads could not be checked just now, so duplicates cannot be shown. Try again.' },
      { status: 503 },
    )
  }

  const duplicates = contacts.map(c => {
    const byPhone = phoneVariants(c.phone).some(v => existingPhones.has(v))
    const email = String(c.email || '').trim().toLowerCase()
    const byEmail = Boolean(email) && existingEmails.has(email)
    return byPhone ? 'phone' : byEmail ? 'email' : null
  })

  return NextResponse.json({
    success: true,
    duplicates,
    /** How many of the rows sent are already on file. */
    count: duplicates.filter(Boolean).length,
    checked: contacts.length,
    /** Rows whose number is not a Ghanaian mobile, for the same preview. */
    unreachable: contacts.map(c => !canonicalPhone(c.phone) && !String(c.email || '').includes('@')),
  })
})
