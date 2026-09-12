/**
 * What the lead is asking for, decided before the model is called.
 *
 * Pure and dependency-free, deliberately. Section 16 of the brief: human
 * detection happens BEFORE the model call, so the assistant cannot talk
 * itself out of a handover and a person asking for a person reaches one even
 * when the model is unavailable, out of credit, or simply wrong that day.
 *
 * The model still does the language work — wording, nuance, extraction. This
 * decides the things that must not depend on it.
 */

export type Intent =
  | 'human'          // they want a person
  | 'payment'        // their own money: paid, refund, balance
  | 'complaint'
  | 'brochure'
  | 'register'
  | 'price'
  | 'schedule'
  | 'greeting'
  | 'question'       // everything else

/** Intents that must reach a person, whatever else is happening. */
export const ESCALATING: ReadonlySet<Intent> = new Set<Intent>(['human', 'payment', 'complaint'])

const RULES: Array<[Intent, RegExp]> = [
  /*
   * A person. Fifteen-plus phrasings, because "can I speak to someone" is not
   * a keyword, it is a thing people say forty different ways — including
   * naming the marketer they were told about.
   */
  ['human', /\b(speak|speaking|spk|talk|talking|chat|chatting|connect|connected)\s*(to|with|me\s+to)?\s*(a|an|the|some|your|our)?\s*(real|actual|live|human)?\s*(human|person|people|someone|somebody|anyone|agent|advisor|adviser|consultant|representative|rep|staff|team|marketer|officer|man|woman|lady|guy)\b/i],
  /*
   * Asking for the colleague by name. The opening message tells them who is
   * handling their enquiry, so "connect me to Ruth" is the natural way to ask
   * — and the one phrasing a keyword list would never contain, because the
   * keyword is a person's name.
   */
  ['human', /\b(speak|talk|chat|connect|connected|put\s+me\s+through)\s*(to|with|me\s+to)\s+[A-Z][a-z]+\b/],
  ['human', /\b(let|can)\s+me\s+(speak|talk|chat)\s+(to|with)\b/i],
  ['human', /\b(is|are)\s+(this|that|it|you)\s+(a\s+)?(bot|robot|machine|ai|computer|automated|human|person|real)\b/i],
  ['human', /\bam\s+i\s+(talking|speaking|chatting)\s+(to|with)\s+(a\s+)?(bot|robot|machine|computer|human|person|real)\b/i],
  ['human', /\b(human|person|someone|somebody|agent)\s*(please|pls|plz|abeg|biko)\b/i],
  ['human', /\b(call|ring|phone)\s+me\b/i],
  ['human', /\b(give|send)\s+me\s+a\s+(call|ring)\b/i],
  ['human', /\bcan\s+(someone|somebody|anyone|a\s+person)\s+(call|ring|phone|help|assist|contact)\b/i],
  ['human', /\b(i\s+)?(need|want|prefer)\s+(to\s+)?(speak|talk|a\s+real|human|real\s+person|customer\s+(care|service)|support)\b/i],
  ['human', /\b(put|pass|transfer|forward)\s+me\s+(to|through)\b/i],
  ['human', /\bhuman\s+assistance\b/i],
  ['human', /\b(not|don'?t\s+want|dont\s+want|no)\s+(a\s+)?(bot|robot|machine|ai)\b/i],

  /*
   * Their own money. The assistant cannot see anyone's record and must not
   * appear to, so every one of these is a handover rather than an answer.
   */
  ['payment', /\b(refund|money\s*back|charge\s*back|chargeback)\b/i],
  ['payment', /\bmy\s+(payment|balance|receipt|fees?|money|transaction|account)\b/i],
  ['payment', /\bi\s*('ve|\s+have)?\s*(already\s+)?(paid|sent|transferred|deposited)\b/i],
  ['payment', /\b(payment|money|transfer|momo|cash)\s+(has|hasn'?t|have|has\s+not|is|isn'?t|is\s+not|not|never)\s*(yet\s+)?(been\s+)?(cleared|clear|reflected|reflect|shown|showing|show|gone\s+through|received|confirmed|credited)\b/i],
  ['payment', /\b(confirm|check|verify)\s+(my|the)\s+(payment|transfer|deposit)\b/i],
  ['payment', /\b(haven'?t|hasn'?t|not)\s+(yet\s+)?(received|got|gotten|seen)\s+(my\s+|any\s+|the\s+)?(confirmation|receipt|admission|invoice|acknowledg)/i],
  ['payment', /\bwhy\s+(haven'?t|hasn'?t|have\s+i\s+not|has\s+it\s+not)\b[\s\S]{0,40}\b(received|confirmation|receipt|cleared|reflected)\b/i],
  ['payment', /\b(momo|mobile\s*money|transfer|deposit|payment)\b[\s\S]{0,30}\b(did\s*n[o']?t|didn'?t|failed|not)\s*(go\s*through|work|reflect|show)/i],
  ['payment', /\bdid\s+(you|u)\s+(get|receive)\s+(my|the)\s+(payment|money|transfer)\b/i],

  ['complaint', /\b(complain|complaint|complaining|unhappy|dissatisfied|disappointed|scam|scammed|fraud|fraudulent|cheat|cheated|rip\s*off|report\s+(you|this))\b/i],

  /*
   * A brochure, however they name the document.
   */
  ['brochure', /\b(brochure|prospectus|flyer|leaflet|booklet)\b/i],
  ['brochure', /\b(send|share|forward|get|have|see|view|show)\s+(me\s+)?(the\s+|a\s+|your\s+)?(pdf|document|doc|details\s+document|course\s+(document|outline|content)|syllabus|curriculum|outline)\b/i],
  ['brochure', /\bdo\s+you\s+have\s+(a\s+)?(pdf|brochure|document|outline|syllabus)\b/i],

  /*
   * Registration intent. A conversion signal, not merely a question.
   */
  ['register', /\b(register|registration|registering|enrol|enroll|enrolling|enrolment|enrollment|sign\s*up|signup|apply|application)\b/i],
  ['register', /\b(i\s+)?(want|wanna|would\s+like|like)\s+to\s+(join|start|begin|come|attend|do\s+(it|the|this))\b/i],
  ['register', /\b(put|add)\s+me\s+(down|in)\b/i],
  ['register', /\b(count|book)\s+me\s+(in|for)\b/i],
  ['register', /\bhow\s+(do|can)\s+i\s+(join|start|pay|register)\b/i],
  ['register', /\bi'?m\s+(in|ready)\b/i],

  ['price', /\b(how\s*much|price|pricing|cost|costs|fee|fees|charge|charges|amount|affordable|instal?ments?|payment\s+plan|pay\s+in\s+bits)\b/i],

  ['schedule', /\b(when|what\s+time|which\s+day|start|starts|starting|begin|begins|next\s+(class|cohort|batch|session|intake)|schedule|timetable|duration|how\s+long|weekend|weekday|evening|online|in\s*person|venue|where)\b/i],

  ['greeting', /^\s*(hi|hello|hey|good\s*(morning|afternoon|evening)|yo|hola|ekuafoa|maakye|maaha|maadwo)\b[\s!.,]*$/i],
]

/**
 * Classify one message.
 *
 * Order matters: the escalating intents are tested first, so "I already paid,
 * how much is the balance" reaches a person rather than being answered as a
 * price question. Somebody's own money outranks curiosity about a fee.
 */
export function classify(text: string): Intent {
  const t = String(text || '')
  if (!t.trim()) return 'question'

  for (const [intent, re] of RULES) {
    if (re.test(t)) return intent
  }
  return 'question'
}

/**
 * Every intent present in the message, in priority order.
 *
 * "Send me the brochure and how much is it" is both. The caller answers the
 * first and may still act on the rest.
 */
export function classifyAll(text: string): Intent[] {
  const t = String(text || '')
  const found: Intent[] = []
  for (const [intent, re] of RULES) {
    if (!found.includes(intent) && re.test(t)) found.push(intent)
  }
  return found.length ? found : ['question']
}

/**
 * How close this person is to registering.
 *
 * Internal only — section 21 of the brief: the score orders a marketer's
 * queue and is never quoted back to the lead. Deterministic, because a
 * priority list that changes when the model is in a different mood is not a
 * priority list.
 */
export type IntentScore = 'LOW' | 'MEDIUM' | 'HIGH' | 'READY_TO_REGISTER'

export function scoreIntent(text: string, history: string[] = []): IntentScore {
  const intents = classifyAll(text)

  if (intents.includes('register')) return 'READY_TO_REGISTER'
  if (intents.includes('payment')) return 'READY_TO_REGISTER'   // they are already paying

  // Asking when it starts is a stronger signal than asking what it costs:
  // price is curiosity, timing is planning.
  if (intents.includes('schedule')) return 'HIGH'
  if (intents.includes('brochure')) return 'HIGH'
  if (intents.includes('price')) return 'MEDIUM'

  // A conversation that has kept going is worth more than a single message.
  if (history.length >= 6) return 'MEDIUM'

  return 'LOW'
}
