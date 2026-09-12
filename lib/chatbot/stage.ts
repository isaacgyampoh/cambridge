/**
 * Where a conversation has got to.
 *
 * ── WHY THIS IS NOT LEFT TO THE MODEL ──────────────────────────────────────
 *
 * Section 4 of the brief: "Do not depend entirely on the LLM to remember the
 * state." A model asked to recall whether somebody already requested a
 * brochure will usually be right, and the times it is wrong are the times it
 * matters — asking a lead for their name twice, or offering registration to
 * somebody who registered yesterday.
 *
 * So the stage is computed from events that actually happened, and stored.
 * Pure and dependency-free, so the transitions can be exercised directly.
 */

export type Stage =
  | 'NEW'
  | 'DISCOVERY'
  | 'PROGRAMME_INTEREST'
  | 'PROGRAMME_DETAILS'
  | 'PRICE_DISCUSSION'
  | 'BROCHURE_REQUEST'
  | 'REGISTRATION_INTENT'
  | 'REGISTRATION'
  | 'PAYMENT_GUIDANCE'
  | 'HUMAN_REQUESTED'
  | 'HANDED_OVER'
  | 'COMPLETED'

/**
 * How far through the funnel each stage is.
 *
 * A conversation moves forward, not back: somebody who asked to register and
 * then asks a follow-up question about the schedule has not stopped wanting
 * to register. Without this, one idle question would drop a hot lead back to
 * DISCOVERY and every marketer queue ordered by stage would be wrong.
 */
const DEPTH: Record<Stage, number> = {
  NEW: 0,
  DISCOVERY: 1,
  PROGRAMME_INTEREST: 2,
  PROGRAMME_DETAILS: 3,
  PRICE_DISCUSSION: 4,
  BROCHURE_REQUEST: 4,
  REGISTRATION_INTENT: 5,
  REGISTRATION: 6,
  PAYMENT_GUIDANCE: 6,
  // Terminal-ish: reached from anywhere, and never rolled back by a message.
  HUMAN_REQUESTED: 7,
  HANDED_OVER: 8,
  COMPLETED: 9,
}

/** Stages a further message must not move away from. */
const STICKY: ReadonlySet<Stage> = new Set<Stage>(['HANDED_OVER', 'COMPLETED'])

export type StageSignal = {
  /** What the lead's message was about. */
  intent: 'human' | 'payment' | 'complaint' | 'brochure' | 'register' | 'price' | 'schedule' | 'greeting' | 'question'
  /** True once a programme has actually been identified. */
  hasProgramme?: boolean
  /** True once the lead's line of work is known. */
  hasProfession?: boolean
  /** Set when the conversation has been given to a person. */
  handedOver?: boolean
}

/**
 * The stage after this message.
 *
 * Monotonic except where a signal is explicitly terminal: a handover always
 * wins, and a completed conversation stays completed.
 */
export function nextStage(current: Stage, signal: StageSignal): Stage {
  if (STICKY.has(current)) return current
  if (signal.handedOver) return 'HANDED_OVER'

  const candidate = stageFor(signal)

  /*
   * Never move BACKWARDS — but a signal at the same depth is not backwards.
   *
   * This was `>`, which meant a lead who asked the fee and then asked for the
   * brochure stayed on "Asking about fees": the two sit at the same depth, so
   * the newer and more actionable signal was discarded and the marketer's
   * queue described the wrong thing.
   *
   * Depth exists to stop a later idle question demoting a hot lead. Between
   * two signals of equal weight the more recent one is the better description
   * of where the conversation actually is.
   */
  return DEPTH[candidate] >= DEPTH[current] ? candidate : current
}

function stageFor(signal: StageSignal): Stage {
  switch (signal.intent) {
    case 'human':
    case 'complaint':
      return 'HUMAN_REQUESTED'
    case 'payment':
      return 'PAYMENT_GUIDANCE'
    case 'register':
      return 'REGISTRATION_INTENT'
    case 'brochure':
      return 'BROCHURE_REQUEST'
    case 'price':
      return 'PRICE_DISCUSSION'
    case 'schedule':
      return 'PROGRAMME_DETAILS'
    case 'greeting':
      return 'DISCOVERY'
    default:
      // An ordinary question means something different depending on how much
      // is already known about them.
      if (signal.hasProgramme) return 'PROGRAMME_INTEREST'
      if (signal.hasProfession) return 'DISCOVERY'
      return 'DISCOVERY'
  }
}

/** Is this conversation with a person now? */
export function isWithHuman(stage: Stage): boolean {
  return stage === 'HANDED_OVER'
}

/** Worth a marketer's attention before the rest of the queue. */
export function isHighIntent(stage: Stage): boolean {
  return DEPTH[stage] >= DEPTH.REGISTRATION_INTENT
}

/** A label for the marketer's screen. */
export const STAGE_LABEL: Record<Stage, string> = {
  NEW: 'New',
  DISCOVERY: 'Getting to know them',
  PROGRAMME_INTEREST: 'Interested in a programme',
  PROGRAMME_DETAILS: 'Asking about details',
  PRICE_DISCUSSION: 'Asking about fees',
  BROCHURE_REQUEST: 'Asked for the brochure',
  REGISTRATION_INTENT: 'Wants to register',
  REGISTRATION: 'Registering',
  PAYMENT_GUIDANCE: 'Asking about payment',
  HUMAN_REQUESTED: 'Asked for a person',
  HANDED_OVER: 'With a colleague',
  COMPLETED: 'Done',
}
