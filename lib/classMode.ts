/**
 * Class mode — the single canonical representation.
 *
 * THE BUG THIS EXISTS TO KILL
 *
 * The system had three vocabularies and two opposite defaults for one concept:
 *
 *   applications.delivery   free text   'online' | 'in_person'
 *   batches.class_type      pg enum     'online' | 'physical'
 *   submit route default    'online'
 *   everywhere else default 'in_person'
 *
 * So an applicant whose form did not send `delivery` was stored as ONLINE,
 * because that was submit's default, while every other module in the system
 * assumed IN_PERSON. A physical registration became a virtual record at the
 * moment of creation, and every downstream document — letter, brochure, email
 * — was then correctly generated for the wrong mode. That is precisely the
 * "virtual registration → physical letter, physical registration → virtual
 * letter" report.
 *
 * THE RULE
 *
 * `ClassMode` below is the only representation business logic may use.
 * Storage spellings are reached through the adapters, never written by hand.
 * There is deliberately NO default: an absent class mode is a validation
 * error, because guessing it is what caused the bug.
 *
 * This module has no imports so it can be unit tested directly.
 */

/** The canonical values. Matches applications.delivery, which drives admissions. */
export type ClassMode = 'online' | 'in_person'

export const CLASS_MODES: readonly ClassMode[] = ['online', 'in_person'] as const

/** How batches.class_type spells the same thing (a Postgres ENUM). */
export type BatchClassType = 'online' | 'physical'

/**
 * Every spelling seen across the codebase, forms, imports and provider
 * payloads, mapped to the canonical value.
 *
 * Being liberal in what we ACCEPT is safe; being liberal in what we STORE is
 * what caused the problem. Everything is normalised on the way in.
 */
const SYNONYMS: Record<string, ClassMode> = {
  // online
  online: 'online',
  virtual: 'online',
  virtual_class: 'online',
  'virtual class': 'online',
  remote: 'online',
  zoom: 'online',
  distance: 'online',
  e_learning: 'online',
  elearning: 'online',
  // in person
  in_person: 'in_person',
  'in person': 'in_person',
  inperson: 'in_person',
  physical: 'in_person',
  physical_class: 'in_person',
  'physical class': 'in_person',
  onsite: 'in_person',
  on_site: 'in_person',
  'on site': 'in_person',
  campus: 'in_person',
  classroom: 'in_person',
  face_to_face: 'in_person',
  'face to face': 'in_person',
  in_class: 'in_person',
  'in class': 'in_person',
  inclass: 'in_person',
}

/**
 * Normalise any input to a canonical ClassMode, or null when it is absent or
 * unrecognised.
 *
 * Returning null rather than a default is the point: the caller must decide
 * explicitly what to do, and every caller in this codebase treats null as a
 * validation failure rather than silently picking a mode.
 */
export function parseClassMode(value: unknown): ClassMode | null {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!key) return null
  return SYNONYMS[key] ?? SYNONYMS[key.replace(/_/g, ' ')] ?? null
}

/** Parse, or throw with a message suitable for showing to a person. */
export function requireClassMode(value: unknown): ClassMode {
  const mode = parseClassMode(value)
  if (!mode) {
    throw new ClassModeError(
      `Please choose whether this is an online or in-person class. Received: ${
        value === undefined || value === null || value === '' ? '(nothing)' : JSON.stringify(value)
      }`
    )
  }
  return mode
}

export class ClassModeError extends Error {
  readonly field = 'classMode'
}

export function isClassMode(value: unknown): value is ClassMode {
  return value === 'online' || value === 'in_person'
}

// ── Storage adapters ────────────────────────────────────────────────────────

/** applications.delivery stores the canonical value verbatim. */
export function toDeliveryColumn(mode: ClassMode): ClassMode {
  return mode
}

/** batches.class_type is a Postgres ENUM spelling in_person as 'physical'. */
export function toBatchClassType(mode: ClassMode): BatchClassType {
  return mode === 'online' ? 'online' : 'physical'
}

/** Read batches.class_type back into the canonical vocabulary. */
export function fromBatchClassType(value: unknown): ClassMode | null {
  return parseClassMode(value)
}

// ── Presentation ────────────────────────────────────────────────────────────

/** How the mode is named to a person: on a letter, in an email, in the portal. */
export function classModeLabel(mode: ClassMode): string {
  return mode === 'online' ? 'Virtual' : 'In-Person'
}

/** A fuller phrase for letter and email bodies. */
export function classModeDescription(mode: ClassMode): string {
  return mode === 'online'
    ? 'online, delivered live over Zoom'
    : 'in person, at the Cambridge campus'
}

/** The scope value used to tag documents for one mode or the other. */
export type DeliveryScope = ClassMode | 'both'

export function scopeMatches(scope: unknown, mode: ClassMode): boolean {
  if (scope === null || scope === undefined || scope === '' || scope === 'both') return true
  const parsed = parseClassMode(scope)
  return parsed === mode
}

/**
 * Does this document belong to the OTHER mode?
 *
 * Used to make an explicit refusal possible: sending an in-person student the
 * virtual letter is worse than sending nothing and raising the problem.
 */
export function scopeIsWrongMode(scope: unknown, mode: ClassMode): boolean {
  const parsed = parseClassMode(scope)
  return parsed !== null && parsed !== mode
}
