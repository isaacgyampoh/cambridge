/*
 * Import-free, so every rule here is unit tested directly.
 */

/**
 * TURNING SOMEBODY ELSE'S SPREADSHEET INTO OUR FIELDS.
 *
 * ── WHY THE COLUMNS ARE MAPPED AND NOT COUNTED ─────────────────────────────
 *
 * The importer used to read columns BY POSITION: the first was a name, the
 * second a phone, and so on. That works for a file generated from our own
 * template and for nothing else. A Google Sheet exported from a Facebook lead
 * form puts its columns in whatever order the form had, and a purchased list
 * arrives in whatever order the seller felt like — so the second column being
 * an email address meant every email was imported as a phone number, every
 * phone as a name, and the operator found out afterwards.
 *
 * Columns are matched by their HEADER now, and what the system decided is
 * shown for correction before a single row is written.
 *
 * ── AND WHY COURSE AND INDUSTRY CANNOT BE CONFUSED ─────────────────────────
 *
 * They arrive side by side — "PMP" and "Agriculture" — and they are different
 * facts about the same person: what they want to study, and what they do.
 * Putting one in the other's field is not a cosmetic error; it is a lead
 * recorded as wanting to study Agriculture, filed under the industry PMP,
 * and found by neither search. The aliases below keep them apart, and a test
 * holds the line.
 */

/** A field of ours that a spreadsheet column can be mapped onto. */
export type FieldKey =
  | 'full_name' | 'phone' | 'email' | 'course_interest' | 'industry'
  | 'company' | 'source' | 'city' | 'notes' | 'assigned_to'

export type FieldDef = {
  key: FieldKey
  label: string
  /** The operator cannot import without it. */
  required?: boolean
  /** What it is for, shown beside the mapping control. */
  hint?: string
  /** Header spellings that mean this field, lowercase, matched as whole text. */
  aliases: readonly string[]
}

export const FIELDS: readonly FieldDef[] = [
  {
    key: 'full_name', label: 'Full name', required: true,
    aliases: ['full name', 'fullname', 'name', 'full_name', 'client name', 'lead name',
      'customer name', 'contact name', 'names', 'applicant name', 'first name'],
  },
  {
    key: 'phone', label: 'Phone number',
    hint: 'A name plus a phone or an email is the minimum for a lead.',
    aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'tel',
      'contact', 'contact number', 'whatsapp', 'whatsapp number', 'msisdn', 'cell'],
  },
  {
    key: 'email', label: 'Email address',
    aliases: ['email', 'e-mail', 'email address', 'e mail', 'mail', 'email_address'],
  },
  {
    key: 'course_interest', label: 'Course of interest',
    hint: 'What they want to study — PMP, PHRi. Never the same column as industry.',
    aliases: ['course', 'course of interest', 'course interest', 'programme', 'program',
      'programme of interest', 'program of interest', 'course_interest', 'training',
      'certification', 'interested in', 'course applied for'],
  },
  {
    key: 'industry', label: 'Industry',
    hint: 'What they do for a living — Mining, Banking. Never the same column as course.',
    aliases: ['industry', 'sector', 'business sector', 'industry sector', 'field',
      'line of business', 'industry/sector', 'work sector', 'profession sector'],
  },
  {
    key: 'company', label: 'Company or organisation',
    hint: 'There is no company field on a lead, so this is added to their notes.',
    aliases: ['company', 'organisation', 'organization', 'employer', 'company name',
      'organisation name', 'organization name', 'workplace', 'institution'],
  },
  {
    key: 'source', label: 'Lead source',
    aliases: ['source', 'lead source', 'channel', 'origin', 'came from'],
  },
  {
    key: 'city', label: 'City',
    aliases: ['city', 'town', 'location', 'region', 'area'],
  },
  {
    key: 'notes', label: 'Notes',
    aliases: ['notes', 'note', 'comment', 'comments', 'remarks', 'remark', 'details'],
  },
  {
    key: 'assigned_to', label: 'Assign to (staff name or email)',
    hint: 'Honoured only when you are allowed to assign leads to other people.',
    aliases: ['assigned to', 'assigned', 'marketer', 'owner', 'staff', 'agent',
      'assigned_to', 'handled by', 'account manager'],
  },
]

export const FIELD_KEYS: readonly FieldKey[] = FIELDS.map(f => f.key)

/** header index → our field. A column nobody mapped is simply absent. */
export type ColumnMapping = Record<number, FieldKey>

function normaliseHeader(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[‘’“”]/g, '')
    .toLowerCase()
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Work out which column is which, from the header row.
 *
 * ── EXACT BEFORE LOOSE, AND FIRST COLUMN WINS ──────────────────────────────
 *
 * Every field is matched on an exact header first, across all columns, before
 * any looser matching is tried. "Course" and "Course of Interest" in the same
 * file must not race: the exact one takes it.
 *
 * A field is claimed once. A file with "Phone" and "Mobile" has two columns
 * meaning the same thing, and the first is used rather than the last silently
 * overwriting it.
 */
export function guessMapping(headers: readonly unknown[]): ColumnMapping {
  const normalised = headers.map(normaliseHeader)
  const mapping: ColumnMapping = {}
  const takenColumn = new Set<number>()
  const takenField = new Set<FieldKey>()

  const claim = (index: number, key: FieldKey) => {
    if (takenColumn.has(index) || takenField.has(key)) return
    mapping[index] = key
    takenColumn.add(index)
    takenField.add(key)
  }

  // 1. Exact header matches.
  for (const field of FIELDS) {
    for (let i = 0; i < normalised.length; i++) {
      if (field.aliases.includes(normalised[i])) claim(i, field.key)
    }
  }

  /*
   * 2. A header that CONTAINS an alias as whole words — "Lead Phone Number",
   *    "Industry (sector)".
   *
   *    Longest alias first. With the list as it stands this changes nothing:
   *    every real collision is already settled by the exact pass above, or by
   *    a field having been claimed. It is here so that ADDING a multi-word
   *    alias later cannot have it decided by a shorter one from another
   *    field — checked by searching every pair of aliases for a header whose
   *    result depends on the order, which currently finds none.
   */
  const loose = FIELDS.flatMap(f => f.aliases.map(a => ({ key: f.key, alias: a })))
    .sort((a, b) => b.alias.length - a.alias.length)

  for (const { key, alias } of loose) {
    for (let i = 0; i < normalised.length; i++) {
      if (takenColumn.has(i) || takenField.has(key)) continue
      const words = ` ${normalised[i]} `
      if (words.includes(` ${alias} `)) claim(i, key)
    }
  }

  return mapping
}

/**
 * A spreadsheet cell as text.
 *
 * ── THE LEADING ZERO ───────────────────────────────────────────────────────
 *
 * Excel reads 0240000001 as the number 240000001 and drops the zero, so a
 * phone column arrives as numbers nine digits long. That is recoverable —
 * canonicalPhone treats nine digits as a local number — but only if the cell
 * is turned into text without scientific notation or a trailing ".0", which
 * is what String() on a float gives for a long number.
 *
 * Dates are left to the caller: a date in a lead field is a mapping mistake,
 * and silently formatting it would hide that.
 */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    if (Number.isInteger(value)) {
      /*
       * No exponent, no trailing ".0" — a phone number is not 2.4e8.
       *
       * toFixed is not enough on its own: it switches to exponent notation at
       * 1e21 exactly as String() does, so a long reference number in a cell
       * would arrive as "1e+21". BigInt renders the integer in full.
       */
      return Math.abs(value) < 1e21 ? value.toFixed(0) : BigInt(value).toString()
    }
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

/** One spreadsheet row, read through a mapping. Values are text, untouched. */
export function readRow(
  cells: readonly unknown[],
  mapping: ColumnMapping,
): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {}
  for (const [indexText, key] of Object.entries(mapping)) {
    const text = cellToText(cells[Number(indexText)])
    if (text) out[key] = text
  }
  return out
}

/** Is there anything at all in this row? Blank rows are skipped, not failed. */
export function rowIsEmpty(cells: readonly unknown[]): boolean {
  return cells.every(c => cellToText(c) === '')
}

/**
 * Which headers were not mapped onto anything.
 *
 * Shown to the operator rather than discarded in silence: a column called
 * "Date of Birth" that nobody mapped is fine, and a column called "Tel" that
 * nobody mapped is a file about to import without phone numbers.
 */
export function unmappedHeaders(
  headers: readonly unknown[],
  mapping: ColumnMapping,
): string[] {
  return headers
    .map((h, i) => ({ text: cellToText(h), i }))
    .filter(({ text, i }) => text !== '' && mapping[i] === undefined)
    .map(({ text }) => text)
}

/** Fields the file does not supply at all. */
export function missingFields(mapping: ColumnMapping): FieldKey[] {
  const present = new Set(Object.values(mapping))
  return FIELD_KEYS.filter(k => !present.has(k))
}
