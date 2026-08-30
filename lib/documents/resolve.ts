import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { type ClassMode, scopeMatches, scopeIsWrongMode } from '@/lib/classMode'
import type { FieldPos } from '@/lib/documentFill'

/**
 * One resolver for every official document.
 *
 * Admission letters and brochures were selected by two entirely separate code
 * paths with different rules:
 *
 *   Admission letters (app/api/applications/complete) DID consider delivery
 *   scope, through four inline queries ordered most-specific first.
 *
 *   Brochures (lib/courseMatch.ts findBrochure) took ONLY a course id. Class
 *   mode was not a parameter and never had been, so an online and an in-person
 *   applicant on the same programme necessarily received the identical
 *   brochure — which is the wrong-brochure report.
 *
 * Both now come through here, so the specificity rules are written once and a
 * new document type inherits them.
 *
 * THE ORDERING, most specific first:
 *   1. this course  + this exact mode
 *   2. this course  + marked for both modes (or unscoped)
 *   3. any course   + this exact mode
 *   4. any course   + marked for both modes (or unscoped)
 *
 * A document explicitly scoped to the OTHER mode is never returned at any
 * level. Sending an in-person student the virtual letter is worse than sending
 * nothing, so this refuses instead of falling back.
 */

export type DocumentType = 'admission_letter' | 'brochure' | 'course_material' | 'receipt' | 'registration_form'

export type ResolvedDocument = {
  id: string
  fileUrl: string
  name: string | null
  isTemplate: boolean
  /** Typed as the document filler expects, so callers need no cast. */
  fieldPositions: FieldPos[] | null
  /** Which rule matched, for logging and for the observability screen. */
  matchedBy: 'course+mode' | 'course+both' | 'general+mode' | 'general+both'
}

export type ResolveOptions = {
  type: DocumentType
  courseId?: string | null
  /**
   * The applicant's class mode, or null when it is genuinely not known yet —
   * an enquiring lead has not chosen one. A null mode resolves ONLY to
   * mode-neutral documents (scoped 'both', or unscoped); it never falls back
   * to a mode-specific one, because a coin-flip between the virtual and the
   * in-person brochure is the behaviour being fixed.
   */
  classMode: ClassMode | null
}

type DocRow = {
  id: string
  file_url: string | null
  name: string | null
  is_active: boolean | null
  is_template: boolean | null
  field_positions: FieldPos[] | null
  delivery_scope: string | null
  course_id: string | null
  created_at: string
}

const SELECT = 'id, file_url, name, is_active, is_template, field_positions, delivery_scope, course_id, created_at'

/**
 * Find the right document, or null.
 *
 * Null is a legitimate answer and callers must handle it — for an admission
 * letter that means falling back to the generated PDF; for a brochure it means
 * sending none rather than the wrong one.
 */
export async function resolveDocument(opts: ResolveOptions): Promise<ResolvedDocument | null> {
  const sb = createServiceClient()
  const { type, courseId, classMode } = opts

  // One query, then all four rules applied in memory. The previous letter code
  // issued up to four separate round trips to answer the same question.
  const { data, error } = await sb.from('documents')
    .select(SELECT)
    .eq('type', type)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[documents] resolve failed:', error.message)
    return null
  }

  // `is_active` is tolerated as null — only an explicit false deactivates.
  const usable = (data || []).filter((d: DocRow) => d.is_active !== false && d.file_url)

  const forThisCourse = courseId ? usable.filter(d => d.course_id === courseId) : []
  const general = usable.filter(d => !d.course_id)

  const exactMode = (rows: DocRow[]) =>
    classMode === null ? undefined : rows.find(d => {
      const s = d.delivery_scope
      return s !== null && s !== undefined && s !== '' && s !== 'both' && scopeMatches(s, classMode)
    })

  const bothOrUnscoped = (rows: DocRow[]) =>
    rows.find(d => {
      // Never a document belonging to the other mode.
      if (classMode !== null && scopeIsWrongMode(d.delivery_scope, classMode)) return false
      const s = d.delivery_scope
      return s === null || s === undefined || s === '' || s === 'both'
    })

  const attempts: Array<[DocRow | undefined, ResolvedDocument['matchedBy']]> = [
    [exactMode(forThisCourse), 'course+mode'],
    [bothOrUnscoped(forThisCourse), 'course+both'],
    [exactMode(general), 'general+mode'],
    [bothOrUnscoped(general), 'general+both'],
  ]

  for (const [row, matchedBy] of attempts) {
    if (row?.file_url) {
      return {
        id: row.id,
        fileUrl: row.file_url,
        name: row.name,
        isTemplate: row.is_template === true,
        fieldPositions: Array.isArray(row.field_positions) ? row.field_positions : null,
        matchedBy,
      }
    }
  }

  return null
}

/**
 * The brochure for a programme and class mode.
 *
 * Replaces findBrochure(courseId), which had no mode dimension at all. Keeps
 * that function's most valuable safeguard: a general brochure is only used if
 * its name does not name a DIFFERENT course, because sending someone another
 * programme's brochure is worse than sending none.
 */
export async function resolveBrochure(
  courseId: string | null | undefined,
  classMode: ClassMode | null
): Promise<string | null> {
  const direct = await resolveDocument({ type: 'brochure', courseId, classMode })
  if (direct) {
    // A general brochure must not name a different programme.
    if (direct.matchedBy.startsWith('general') && await namesAnotherCourse(direct.name, courseId)) {
      return null
    }
    return direct.fileUrl
  }

  // The course's own brochure_url field is the next best thing.
  if (courseId) {
    const sb = createServiceClient()
    const { data: course } = await sb.from('courses')
      .select('brochure_url').eq('id', courseId).maybeSingle()
    if (course?.brochure_url) return course.brochure_url
  }

  return null   // send nothing rather than the wrong one
}

/** Does this document's name mention a course other than the one wanted? */
async function namesAnotherCourse(
  docName: string | null,
  courseId: string | null | undefined
): Promise<boolean> {
  if (!docName) return false
  const sb = createServiceClient()

  const { data: courses } = await sb.from('courses')
    .select('id, name, code').eq('is_active', true).limit(200)
  if (!courses?.length) return false

  const name = docName.toLowerCase()
  const others = courses.filter((c: { id: string }) => c.id !== courseId)

  return others.some((c: { name: string | null; code: string | null }) => {
    const code = c.code?.toLowerCase()
    const cname = c.name?.toLowerCase()
    if (code && new RegExp(`\\b${escapeRe(code)}\\b`).test(name)) return true
    if (cname && cname.length > 3 && name.includes(cname)) return true
    return false
  })
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
