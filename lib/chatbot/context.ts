import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { CONFIG } from '@/lib/config'
import { loadProgrammes, matchProgramme, capabilityOf, type Programme, type ProgrammeCapability } from '@/lib/chatbot/programme'
import { loadState, type ConversationState } from '@/lib/chatbot/events'

/**
 * Everything known about one lead, assembled before the model is called.
 *
 * Section 3 of the brief, and its last line is the important one: "Never
 * invent missing values. If a field is unavailable, treat it as unknown."
 * Every field here is nullable and nothing is defaulted to a plausible
 * stand-in — a lead whose name we do not have is not "there", it is null, and
 * the prompt is told so.
 *
 * This is also where the assistant learns which colleague it is working
 * alongside. The name is used to say who will pick something up. It is never
 * used to sign a message: the assistant is that colleague's assistant, not
 * that colleague.
 */

export type LeadContext = {
  leadId: string | null
  leadName: string | null
  phone: string | null

  marketerId: string | null
  marketerName: string | null
  /** The marketer's personal registration link, so credit survives. */
  registrationLink: string | null

  source: string | null
  campaign: string | null
  landingSource: string | null

  profession: string | null
  courseInterest: string | null

  /** The programme actually matched to a record. Null when it is not clear. */
  programme: Programme | null
  capability: ProgrammeCapability
  /** Everything on offer, for when no single programme is identified. */
  allProgrammes: Programme[]
  /**
   * True when the programme records could not be READ, as distinct from a
   * centre that has none. The assistant hands over on the first and asks a
   * question on the second, so the two must never collapse into each other.
   */
  programmesUnavailable: boolean

  status: string | null
  aiPaused: boolean
  needsHuman: boolean

  state: ConversationState
}

/** Nothing is known. Used when there is no lead record at all. */
const NO_CAPABILITY: ProgrammeCapability = {
  canQuoteFee: false, canShowSchedule: false, canSendBrochure: false, canRegister: false,
}

type LeadRow = {
  id: string
  full_name?: string | null
  phone?: string | null
  assigned_to?: string | null
  source?: string | null
  utm_campaign?: string | null
  landing_source?: string | null
  profession?: string | null
  course_interest?: string | null
  status?: string | null
  ai_paused?: boolean | null
  needs_human?: boolean | null
}

/**
 * Build the context for a conversation.
 *
 * The programme lookup runs against the lead's stated interest first and then
 * against what they have just said, because "I'm interested in the Airbnb
 * course" identifies a programme that the lead record may not yet name.
 */
export async function buildLeadContext(opts: {
  lead: LeadRow | null
  /** The message just received, used to identify a programme if the record does not. */
  latestMessage?: string | null
}): Promise<LeadContext> {
  const { lead, latestMessage } = opts
  const sb = createServiceClient()

  const loaded = await loadProgrammes()
  const programmes = loaded.ok ? loaded.data : []
  if (!loaded.ok) {
    console.error('[chatbot] building a context with no programme data:', loaded.error)
  }

  let marketerName: string | null = null
  let marketerCode: string | null = null
  if (lead?.assigned_to) {
    const { data: m } = await sb.from('profiles')
      .select('full_name, marketer_code').eq('id', lead.assigned_to).maybeSingle()
    marketerName = m?.full_name || null
    marketerCode = m?.marketer_code || null
  }

  const programme =
    matchProgramme(programmes, lead?.course_interest)
    || matchProgramme(programmes, latestMessage)
    || null

  const registrationLink = marketerCode ? `${CONFIG.appUrl}/apply/${marketerCode}` : null

  const state = lead?.id ? await loadState(lead.id) : {
    stage: 'NEW' as const, taken: [], brochureSent: false,
    registrationIntent: false, handedOver: false, recent: [],
  }

  return {
    leadId: lead?.id || null,
    leadName: lead?.full_name || null,
    phone: lead?.phone || null,

    marketerId: lead?.assigned_to || null,
    marketerName,
    registrationLink,

    source: lead?.source || null,
    campaign: lead?.utm_campaign || null,
    landingSource: lead?.landing_source || null,

    profession: lead?.profession || null,
    courseInterest: lead?.course_interest || null,

    programme,
    capability: programme ? capabilityOf(programme, registrationLink) : NO_CAPABILITY,
    allProgrammes: programmes,
    programmesUnavailable: !loaded.ok,

    status: lead?.status || null,
    aiPaused: Boolean(lead?.ai_paused),
    needsHuman: Boolean(lead?.needs_human),

    state,
  }
}

/**
 * The columns buildLeadContext reads from a lead.
 *
 * Exported so the webhook selects exactly these and no more. Every one is
 * confirmed by the Lead interface in types/index.ts except `profession`,
 * `ai_paused` and `needs_human`, which the existing webhook and resume logic
 * already read — so nothing here names a column this codebase has not already
 * proven exists.
 */
export const LEAD_COLUMNS =
  'id, full_name, phone, assigned_to, source, utm_campaign, landing_source, profession, course_interest, status, ai_paused, needs_human'
