/**
 * The rules that decide whether a person gets reached, and how a reply reads.
 *
 * Pure and dependency-free: no database, no model, no server-only import. The
 * decision "this person asked for a human" is too important to be reachable
 * only through a language model that may be unavailable, out of credit, or
 * wrong that day — and too important to be testable only by calling one.
 */

/** Why a conversation is being passed on. Recorded, so the pattern is visible. */
export type HandoffReason =
  | 'asked_for_person'    // they asked to speak to somebody
  | 'ready_to_enrol'      // they want to register or pay
  | 'own_record'          // their payment, their class, their refund
  | 'complaint'
  | 'assistant_unsure'    // it said it would check, or does not know
  | 'no_knowledge'        // nothing configured for it to answer from

export const HANDOFF_LABEL: Record<HandoffReason, string> = {
  asked_for_person: 'They asked to speak to someone',
  ready_to_enrol: 'They are ready to enrol',
  own_record: 'A question about their own payment or class',
  complaint: 'A complaint',
  assistant_unsure: 'The assistant could not answer it',
  no_knowledge: 'The assistant had nothing to answer from',
}

/**
 * Does this message need a person, on its own terms?
 *
 * Deliberately narrow and deterministic. The model raises most handovers
 * through the conversation, but these are the ones that must not depend on it:
 * somebody asking for a human, and somebody raising money they have already
 * paid. The assistant cannot see anyone's record and must not appear to.
 */
export function needsHumanOutright(text: string): HandoffReason | null {
  const t = ` ${String(text || '').toLowerCase()} `

  // Asking for a person, in the ways people actually ask.
  if (/\b(speak|speaking|talk|talking|chat)\s+(to|with)\s+(a|an|the|some)?\s*(real\s+)?(human|person|someone|somebody|anyone|agent|advisor|adviser|consultant|staff|man|woman|lady)\b/.test(t)
    || /\b(is|are)\s+(this|that|you)\s+(a\s+)?(bot|robot|machine|ai|computer|human|person|real)\b/.test(t)
    || /\bam i (talking|speaking|chatting) to a (bot|robot|machine|computer|human|person)\b/.test(t)
    || /\bhuman\s+(please|pls|abeg)\b/.test(t)
    || /\bcall me\b/.test(t)
    || /\bgive me (a )?call\b/.test(t)
    || /\bcan (someone|somebody|anyone) call\b/.test(t)) {
    return 'asked_for_person'
  }

  // Their own money. Never answered by something that cannot see their record.
  if (/\b(refund|money back|my payment|my balance|my receipt|my fees)\b/.test(t)
    || /\bi\s*('ve|\s+have)?\s*(already\s+)?paid\b/.test(t)
    || /\bpayment\s+(has|hasn'?t|has not|is|isn'?t|is not|not)\s*(yet\s+)?(cleared|reflected|shown|showing|gone through)\b/.test(t)) {
    return 'own_record'
  }

  if (/\b(complain|complaint|complaining|unhappy|disappointed|scam|fraud|fraudulent|cheated|report you)\b/.test(t)) {
    return 'complaint'
  }

  return null
}

/**
 * Did the assistant just promise that something would be looked into?
 *
 * The sentence that reassures the lead is the same sentence that has to reach
 * a colleague. A promise nobody was told about is worse than never making it.
 */
export function promisedFollowUp(reply: string): boolean {
  return /\b(let me check|i'?ll check|i will check|come back to you|get back to you|pick this up|get someone|ask (someone|somebody|[A-Z]\w+) to)\b/i
    .test(String(reply || ''))
}

/**
 * Tidy a reply for WhatsApp.
 *
 * ── THIS IS NOT WHAT IT USED TO BE ─────────────────────────────────────────
 *
 * It grew out of a function called humanise(), whose stated job was removing
 * "the tells a model leaves behind" so the person would not realise they were
 * talking to one. That purpose went with the impersonation.
 *
 * What survives is the half that was always just good sense about the medium:
 * em dashes, semicolons and sign-offs read as a letter, and WhatsApp is not a
 * letter. Nobody signs a text message. The assistant says what it is when
 * asked — it simply does not punctuate like a press release.
 */
export function forWhatsApp(text: string): string {
  let t = String(text || '')

  // A trailing sign-off. A bot signing one with an institution's name is
  // precisely the shape this rebuild removes.
  t = t.replace(/\n+\s*[-–—*_]{0,3}\s*(Cambridge[^\n]{0,60}|Admissions[^\n]{0,40}|Sent (via|from)[^\n]*)\s*$/i, '')
  t = t.replace(/\n+\s*(Best regards|Regards|Kind regards|Sincerely|Cheers|Warm regards)[,.]?\s*[\s\S]{0,80}$/i, '')

  return t
    .replace(/\s*[—–]\s*/g, ', ')     // em/en dashes read as written, not typed
    .replace(/\s*;\s*/g, '. ')
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
