import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { CONFIG } from '@/lib/config'

/**
 * Public ingestion endpoint for the existing Google-Sheet sign-in page.
 * Your Google Apps Script posts each new row here (in addition to writing
 * to the sheet). We record it so the system knows who signed in and how many.
 *
 * Auth: a shared secret in the `x-signin-secret` header OR ?secret= query,
 * so random people can't spam it.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const secret = req.headers.get('x-signin-secret') || url.searchParams.get('secret')
  if (secret !== CONFIG.setupSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let row: any
  try { row = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Flexible field mapping — accept common header names
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/[\s_]/g, '') === k.toLowerCase().replace(/[\s_]/g, ''))
      if (found && row[found]) return String(row[found]).trim()
    }
    return null
  }

  const full_name = pick(['name', 'fullname', 'full_name', 'student', 'studentname'])
  const phone = pick(['phone', 'phonenumber', 'mobile', 'contact', 'number'])
  const email = pick(['email', 'emailaddress'])
  const course_interest = pick(['course', 'courseinterest', 'programme', 'program', 'interest'])
  const campus = pick(['campus', 'location', 'branch'])

  if (!full_name && !phone) {
    return NextResponse.json({ error: 'Row needs at least a name or phone' }, { status: 400 })
  }

  const sb = createServiceClient()

  // Try to match an existing lead by phone
  let matched_lead_id: string | null = null
  if (phone) {
    const norm = phone.replace(/[\s\-()]/g, '')
    const variants = [norm, norm.replace(/^0/, '233'), norm.replace(/^233/, '0')]
    const { data: leads } = await sb.from('leads').select('id, phone').limit(2000)
    const m = leads?.find((l: any) => l.phone && variants.includes(l.phone.replace(/[\s\-()]/g, '')))
    matched_lead_id = m?.id || null
  }

  const { error } = await sb.from('external_signins').insert({
    source: 'google_form',
    full_name, phone, email, course_interest, campus,
    raw_row: row,
    matched_lead_id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If this person isn't already a lead, auto-create one so they enter the CRM
  let createdLead = false
  if (!matched_lead_id && phone && full_name) {
    const leadData: any = {
      full_name, phone, email: email || null, status: 'new',
      course_interest: course_interest || null,
      notes: campus ? `Walk-in sign-in at ${campus}` : 'Walk-in sign-in',
    }
    // Try 'walk_in' source; if the enum doesn't have it yet, fall back to 'manual'
    let { data: newLead } = await sb.from('leads').insert({ ...leadData, source: 'walk_in' }).select('id').maybeSingle()
    if (!newLead) {
      const retry = await sb.from('leads').insert({ ...leadData, source: 'manual' }).select('id').maybeSingle()
      newLead = retry.data
    }
    if (newLead) {
      createdLead = true
      await sb.from('external_signins').update({ matched_lead_id: newLead.id }).eq('phone', phone).is('matched_lead_id', null)
    }
  }

  return NextResponse.json({ success: true, matched: !!matched_lead_id, createdLead })
}

// Allow simple GET-based ping to verify the endpoint is live
export async function GET() {
  return NextResponse.json({ ok: true, message: 'Sign-in ingestion endpoint is live. POST rows here.' })
}
