import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Public application submission. Uses the SERVICE ROLE so it bypasses RLS —
 * the applicant isn't logged in, so a browser insert is (correctly) blocked
 * by row-level security. This is the fix for
 * "new row violates row-level security policy for table applications".
 */
export async function POST(req: NextRequest) {
  const body = await req.json()

  // Minimal validation
  if (!body.full_name?.trim() || !body.phone?.trim() || !body.course_id) {
    return NextResponse.json({ error: 'Please fill in your name, phone and programme.' }, { status: 400 })
  }

  const sb = createServiceClient()
  const { data: app, error } = await sb.from('applications').insert({
    marketer_id: body.marketer_id || null,
    full_name: body.full_name,
    first_name: body.first_name || null,
    middle_name: body.middle_name || null,
    last_name: body.last_name || null,
    email: body.email || null,
    phone: body.phone,
    gender: body.gender || null,
    date_of_birth: body.date_of_birth || null,
    country_of_birth: body.country_of_birth || null,
    nationality: body.nationality || null,
    postal_address: body.postal_address || null,
    residential_address: body.residential_address || null,
    address: body.residential_address || null,
    last_school: body.last_school || null,
    certification_attained: body.certification_attained || null,
    course_of_study: body.course_of_study || null,
    year_completed: body.year_completed || null,
    course_id: body.course_id,
    batch_preference: body.batch_preference || null,
    delivery: body.delivery || 'online',
    payment_method: body.payment_method || 'online',
    payment_status: 'pending',
    utm_source: body.utm_source || null,
    utm_medium: body.utm_medium || null,
    utm_campaign: body.utm_campaign || null,
    utm_content: body.utm_content || null,
    landing_source: body.landing_source || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Cash payment = submit immediately (no online payment step)
  if (body.payment_method === 'cash') {
    await sb.from('applications').update({ is_submitted: true, submitted_at: new Date().toISOString() }).eq('id', app.id)
  }

  return NextResponse.json({ success: true, id: app.id })
}
