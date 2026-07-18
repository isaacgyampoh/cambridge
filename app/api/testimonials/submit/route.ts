import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * PUBLIC — a student submits their own testimonial via the shared link.
 * No auth. Body: { token?, student_name, program_name, quote, image_url, role_title }
 * If a token is supplied it pre-binds to a known student/programme.
 */
export async function POST(req: NextRequest) {
  const { token, student_name, program_name, quote, image_url, role_title } = await req.json()
  if (!student_name?.trim() || !quote?.trim()) {
    return NextResponse.json({ error: 'Please add your name and your words' }, { status: 400 })
  }

  const sb = createServiceClient()

  // If a token maps to a prep record / enrollment, inherit the programme
  let program = program_name || null
  let programCode = null
  if (token) {
    const { data: rec } = await sb.from('prep_records').select('program_name, program_code').eq('id', token).maybeSingle()
    if (rec) { program = program || rec.program_name; programCode = rec.program_code }
  }

  const { error } = await sb.from('testimonials').insert({
    student_name: student_name.trim(),
    program_name: program,
    program_code: programCode,
    quote: quote.trim(),
    image_url: image_url?.trim() || null,
    role_title: role_title?.trim() || null,
    approved: false,
    shared: false,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-add to Alumni: anyone who submits a testimonial is an alumnus.
  // Avoid duplicating an existing alumni record for the same person.
  try {
    const { data: existing } = await sb.from('alumni')
      .select('id').ilike('full_name', student_name.trim()).maybeSingle()
    if (!existing) {
      await sb.from('alumni').insert({
        full_name: student_name.trim(),
        course_completed: program || 'Cambridge Center of Excellence',
        photo_url: image_url?.trim() || null,
        current_job_title: role_title?.trim() || null,
        testimonial: quote.trim(),
        graduation_date: new Date().toISOString().slice(0, 10),
        is_published: true,
      })
    } else {
      // Enrich the existing record with the new testimonial/photo
      const upd: any = { testimonial: quote.trim(), is_published: true }
      if (image_url?.trim()) upd.photo_url = image_url.trim()
      if (role_title?.trim()) upd.current_job_title = role_title.trim()
      await sb.from('alumni').update(upd).eq('id', existing.id)
    }
  } catch { /* alumni enrichment optional — never block the testimonial */ }

  return NextResponse.json({ success: true })
}
