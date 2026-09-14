import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSession, GuardError } from '@/lib/auth/guard'
import { lookup } from '@/lib/db/lookup'
import { phoneVariants } from '@/lib/leads/importValidation'
import { buildLeadContext, chatbotReply, LEAD_COLUMNS } from '@/lib/chatbot'
import { whatsappConnected } from '@/lib/messaging'

export const runtime = 'nodejs'

/**
 * Try the assistant without a WhatsApp account.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Every part of the assistant except the transport can be exercised today:
 * lead resolution, programme matching, the real fees, the knowledge base,
 * intent, stage, the money guard and the handover decision. Waiting for
 * WhatsApp credentials to find out whether any of that is right would mean
 * discovering it in front of a customer.
 *
 * ── IT RUNS THE REAL ENGINE ────────────────────────────────────────────────
 *
 * chatbotReply, buildLeadContext and the same lead lookup the webhook uses —
 * not a copy of them. A diagnostic that reimplements what it is diagnosing
 * can only report on itself; the SMS test endpoint in this codebase spent
 * months doing exactly that, cheerfully reporting success through a sender
 * that was never exercised.
 *
 * ── AND IT CHANGES NOTHING ─────────────────────────────────────────────────
 *
 * Nothing is sent, no message is stored, no event is recorded, no handover is
 * raised and no lead is created. It answers with what WOULD happen. That is
 * the point: an administrator can try a phrasing against a real lead's
 * context without touching that lead's conversation or texting them.
 *
 * The response says plainly whether WhatsApp is connected, so "the assistant
 * works" is never mistaken for "the assistant is live".
 */

const Body = z.object({
  /** An existing lead's number, so the reply is built from a real context. */
  phone: z.string().trim().min(6).max(30),
  message: z.string().trim().min(1).max(2000),
})

export async function POST(req: NextRequest) {
  try {
    await requireSession(req, { roles: ['super_admin', 'administrator', 'project_manager'] })
  } catch (e) {
    return (e as GuardError).response
  }

  let parsed
  try {
    parsed = Body.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Send a phone number and a message.' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Send a phone number and a message.' }, { status: 400 })
  }

  const sb = createServiceClient()
  const variants = phoneVariants(parsed.data.phone)
  if (!variants.length) {
    return NextResponse.json({ error: 'That is not a usable phone number.' }, { status: 400 })
  }

  // The same lookup the webhook performs, including the same fail-closed rule:
  // a simulation that quietly invented a lead would be testing the wrong thing.
  const { row: lead, failed } = await lookup(
    sb.from('leads').select(LEAD_COLUMNS)
      .in('phone', variants).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  )
  if (failed) {
    return NextResponse.json(
      { error: 'We could not check that number just now. Please try again in a moment.' },
      { status: 503 },
    )
  }

  const ctx = await buildLeadContext({
    lead: (lead as never) ?? null,
    latestMessage: parsed.data.message,
  })

  const reply = await chatbotReply({ message: parsed.data.message, ctx })

  return NextResponse.json({
    /*
     * Stated on every response, so a successful simulation is never read as a
     * working WhatsApp connection. They are different claims.
     */
    mode: 'simulation',
    sent: false,
    whatsappConnected: whatsappConnected(),

    lead: lead
      ? {
          found: true,
          name: (lead as { full_name?: string }).full_name ?? null,
          // Whether it HAS an owner, never who — this is a diagnostic, and
          // the marketer's identity is not what is being tested.
          assigned: Boolean((lead as { assigned_to?: string }).assigned_to),
        }
      : { found: false, name: null, assigned: false },

    programme: ctx.programme
      ? {
          name: ctx.programme.name,
          feeInPerson: ctx.programme.feeInPerson,
          feeOnline: ctx.programme.feeOnline,
        }
      : null,
    programmesUnavailable: ctx.programmesUnavailable,

    reply: {
      text: reply.text,
      intent: reply.intent,
      stage: reply.stage,
      handoff: reply.handoff,
      skipped: reply.skipped ?? null,
      attachment: reply.attachment?.kind ?? null,
      actions: reply.actions.map(a => a.label),
    },
  })
}
