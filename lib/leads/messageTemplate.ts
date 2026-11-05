/*
 * Import-free, so the rendering is unit tested directly.
 */

/**
 * THE MESSAGE SOMEBODY WROTE, WITH THE RECIPIENT'S OWN DETAILS IN IT.
 *
 * ── WHAT THIS REPLACED ─────────────────────────────────────────────────────
 *
 * The invitation text lived in the code. Whoever created a campaign could set
 * the title and the link and nothing else, and every campaign said the same
 * sentence in the same words. There was no way to say anything of your own,
 * and no record of what any past campaign had said.
 *
 * ── WHAT IS SUBSTITUTED, AND WHAT IS NOT ───────────────────────────────────
 *
 * Only what the recipient's own copy needs: their first name and the link
 * that attributes their join to the right person. Everything else is left
 * exactly as it was typed — a message that quietly grows a sentence nobody
 * wrote is the thing being removed, not a feature to keep.
 */

export type Placeholder = { token: string; label: string; example: string }

export const PLACEHOLDERS: readonly Placeholder[] = [
  { token: '{name}', label: 'Their first name', example: 'Ama' },
  { token: '{link}', label: 'Their own join link', example: 'https://portal.cambridge.edu.gh/j/…' },
  { token: '{title}', label: 'The session name', example: 'PMP Information Session' },
  { token: '{when}', label: 'When the session is', example: '12 Nov 2026, 18:30' },
]

export type RenderContext = {
  session: { id?: string; title?: string | null; scheduled_at?: string | null; message?: string | null; link?: string | null }
  lead: { full_name?: string | null; assigned_to?: string | null; phone?: string | null }
  origin: string
  /** The marketer code to attribute a join to, where one is known. */
  marketerCode?: string | null
}

/** "12 Nov 2026, 18:30" — the session time as a reader sees it. */
export function sessionWhen(scheduledAt: string | null | undefined): string {
  if (!scheduledAt) return ''
  const d = new Date(scheduledAt)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra',
  })
}

/**
 * Put the recipient's details into the author's message.
 *
 * An empty message is NOT replaced with a default. The campaign cannot be
 * created without one, so an empty one here means something upstream went
 * wrong, and sending a sentence nobody wrote would hide it.
 */
export function renderMessage(template: string | null | undefined, ctx: RenderContext): string {
  const text = String(template ?? '')
  if (!text.trim()) return ''

  const first = String(ctx.lead.full_name || '').trim().split(' ')[0] || 'there'
  const code = ctx.marketerCode || 'x'
  const link = ctx.session.id
    ? `${ctx.origin}/j/${ctx.session.id}/${code}${ctx.lead.phone ? `?p=${encodeURIComponent(ctx.lead.phone)}` : ''}`
    : String(ctx.session.link || '')

  return text
    .replace(/\{name\}/g, first)
    .replace(/\{link\}/g, link)
    .replace(/\{title\}/g, String(ctx.session.title || ''))
    .replace(/\{when\}/g, sessionWhen(ctx.session.scheduled_at))
}

/**
 * How many texts one message costs.
 *
 * GSM-7 fits 160 characters in one message and 153 per part once it is split,
 * because a concatenated message spends seven characters a part on the header
 * that puts it back together. A message containing anything outside that
 * alphabet is sent as UCS-2, where the figures are 70 and 67.
 *
 * Worth showing: each part is charged, so a message that goes three characters
 * over doubles the cost of a campaign to eight hundred people.
 */
const GSM7 = /^[A-Za-z0-9@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€\n\r]*$/

export type SegmentCount = { characters: number; segments: number; encoding: 'GSM-7' | 'UCS-2'; perSegment: number }

export function countSegments(message: string): SegmentCount {
  const text = String(message ?? '')
  const unicode = !GSM7.test(text)
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  const characters = text.length

  if (characters === 0) return { characters: 0, segments: 0, encoding: unicode ? 'UCS-2' : 'GSM-7', perSegment: single }
  const segments = characters <= single ? 1 : Math.ceil(characters / multi)
  return {
    characters,
    segments,
    encoding: unicode ? 'UCS-2' : 'GSM-7',
    perSegment: segments === 1 ? single : multi,
  }
}
