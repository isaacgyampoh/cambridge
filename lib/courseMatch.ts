import { createServiceClient } from '@/lib/supabase/server'

/**
 * Work out which course a lead means.
 *
 * A loose "contains" match sent PMP leads an HR brochure, because one course
 * name can contain another and whatever came back first was used. This matches
 * from the most exact to the least, and refuses to guess when two courses fit
 * equally well.
 */
export async function findCourse(interest?: string | null) {
  const raw = String(interest || '').trim()
  if (!raw) return null

  const sb = createServiceClient()
  const { data: courses } = await sb.from('courses')
    .select('id, name, code, price, duration, brochure_url')
    .eq('is_active', true).limit(200)
  if (!courses?.length) return null

  const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = norm(raw)
  if (!target) return null

  // 1. The code, exactly. "PMP" is PMP and nothing else.
  const byCode = courses.find((c: any) => norm(c.code) === target)
  if (byCode) return byCode

  // 2. The name, exactly.
  const byName = courses.find((c: any) => norm(c.name) === target)
  if (byName) return byName

  // 3. The code appearing as a whole word in what they said —
  //    "I want PMP training" finds PMP, but never matches SPHR inside PHRi.
  const wordMatches = courses.filter((c: any) => {
    if (!c.code) return false
    return new RegExp(`\\b${String(c.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(raw)
  })
  if (wordMatches.length === 1) return wordMatches[0]

  // 4. Name contained — but only when exactly one course fits, so an
  //    ambiguous phrase never silently picks the wrong one.
  const nameMatches = courses.filter((c: any) => {
    const n = norm(c.name)
    return n && (n.includes(target) || target.includes(n))
  })
  if (nameMatches.length === 1) return nameMatches[0]

  // 5. If several fit, prefer the longest name that matches — the most
  //    specific one — rather than whichever the database returned first.
  if (nameMatches.length > 1) {
    return nameMatches.sort((a: any, b: any) => norm(b.name).length - norm(a.name).length)[0]
  }

  return null
}

/**
 * The brochure for a course: its own first, a general one only if that course
 * has none. Never another course's brochure.
 */
export async function findBrochure(courseId?: string | null): Promise<string | null> {
  const sb = createServiceClient()

  if (courseId) {
    const { data } = await sb.from('documents')
      .select('file_url').eq('type', 'brochure').eq('course_id', courseId).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (data?.file_url) return data.file_url

    // The course's own field is the next best thing.
    const { data: co } = await sb.from('courses')
      .select('brochure_url').eq('id', courseId).maybeSingle()
    if (co?.brochure_url) return co.brochure_url
  }

  // Only reached when the course genuinely has no brochure of its own.
  const { data: general } = await sb.from('documents')
    .select('file_url').eq('type', 'brochure').is('course_id', null).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return general?.file_url || null
}
