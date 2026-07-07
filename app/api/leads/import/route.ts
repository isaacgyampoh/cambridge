import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { intakeLead } from '@/lib/leadIntake'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'project_manager', 'marketing_officer']

/**
 * Bulk-import leads AND auto-assign each one (weighted lottery) so imported
 * leads behave exactly like leads that arrive from a webhook — assigned,
 * AI-greeted, nurtured. Accepts { leads: [...] }.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leads } = await req.json()
  if (!Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json({ error: 'No leads provided' }, { status: 400 })
  }

  let imported = 0, assigned = 0, duplicates = 0, failed = 0
  for (const l of leads) {
    if (!l.full_name?.trim() || (!l.phone?.trim() && !l.email?.trim())) { failed++; continue }
    try {
      const r = await intakeLead({
        full_name: l.full_name, phone: l.phone, email: l.email,
        course_interest: l.course_interest || null,
        source: l.source || 'manual',
        landing_source: 'Imported',
        extra: { city: l.city || null, notes: l.notes || null },
      })
      if (r.duplicate) duplicates++
      else if (r.leadId) { imported++; if (r.assignedTo) assigned++ }
      else failed++
    } catch { failed++ }
  }

  return NextResponse.json({ success: true, imported, assigned, duplicates, failed })
}
