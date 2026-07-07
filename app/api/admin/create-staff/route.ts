import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN, getSessionFromCookies } from '@/lib/auth/pin'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session.valid || !['super_admin', 'project_manager'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { full_name, email, phone, role, initial_pin, department, coordinator_program, performance_tier, also_markets, reports_to, is_team_lead } = await req.json()

  if (!full_name?.trim() || !phone?.trim() || !role) {
    return NextResponse.json({ error: 'Full name, phone number and role are required' }, { status: 400 })
  }

  // Normalize phone to 233XXXXXXXXX
  const rawPhone = phone.trim().replace(/\s+/g, '')
  const phone233 = rawPhone.startsWith('0') ? '233' + rawPhone.slice(1)
    : rawPhone.startsWith('+') ? rawPhone.slice(1)
    : rawPhone

  // Generate PIN — last 4 digits of phone or custom
  const pin = initial_pin?.trim() || phone233.slice(-4)
  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4-6 digits' }, { status: 400 })
  }

  const sb = createServiceClient()

  // Check phone not already used
  const { data: existingPhone } = await sb.from('profiles')
    .select('id').eq('phone', phone233).maybeSingle()
  if (existingPhone) {
    return NextResponse.json({ error: 'This phone number is already registered' }, { status: 409 })
  }

  // Use provided email or generate a placeholder (needed for Supabase Auth)
  const authEmail = email?.trim() || `${phone233}@cambridge.staff`
  const randomPassword = 'CCE-' + Math.random().toString(36).slice(2, 10) + '!'

  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: authEmail,
    password: randomPassword,
    email_confirm: true,
  })

  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

  const userId = authData.user.id
  // A person markets if their primary role is marketing_officer OR the
  // "also markets" toggle is on (e.g. a PM or accountant who also converts
  // leads). Marketing staff get a shareable code and enter the lead pool.
  const marketsLeads = role === 'marketing_officer' || also_markets === true
  const marketerCode = marketsLeads
    ? full_name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
    : null

  // Tier: marketers default 'mid'; pure non-marketing staff default 'support'.
  const tier = ['high', 'mid', 'low', 'support'].includes(performance_tier)
    ? performance_tier
    : (marketsLeads ? 'mid' : 'support')

  // Base columns that always exist
  const baseProfile: any = {
    id: userId,
    full_name: full_name.trim(),
    email: email?.trim() || null,
    phone: phone233,
    role,
    department: department?.trim() || null,
    coordinator_program: role === 'exam_coordinator' ? (coordinator_program?.trim().toUpperCase() || null) : null,
    pin_hash: hashPIN(pin),
    pin_set_at: new Date().toISOString(),
    must_change_pin: true,
    marketer_code: marketerCode,
    is_active: true,
  }
  // Newer columns (only present if the latest schema has been run). Included
  // when available; if the DB doesn't have them yet we retry without them so
  // onboarding never breaks mid-launch.
  const extendedProfile = {
    ...baseProfile,
    performance_tier: tier,
    in_lead_pool: marketsLeads,
    reports_to: reports_to || null,
    is_team_lead: is_team_lead === true,
  }

  let profileErr: any = null
  {
    const { error } = await sb.from('profiles').insert(extendedProfile)
    if (error && /column .* does not exist|performance_tier|in_lead_pool|reports_to|is_team_lead/i.test(error.message)) {
      // Schema not fully applied — fall back to the base columns.
      const { error: baseError } = await sb.from('profiles').insert(baseProfile)
      profileErr = baseError
    } else {
      profileErr = error
    }
  }

  if (profileErr) {
    await sb.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  // ── Onboarding SMS: send the new staff their login details + portal link ──
  let smsSent = false
  try {
    const { sendSMS } = await import('@/lib/integrations/sms')
    const portalUrl = 'https://portal.cambridge.edu.gh'
    const firstName = full_name.trim().split(' ')[0]
    const roleLabel = role.replace(/_/g, ' ')
    const msg =
      `Hi ${firstName}, welcome to Cambridge Centre of Excellence!\n` +
      `You've been added as ${roleLabel}.\n` +
      `Portal: ${portalUrl}\n` +
      `Login with your phone (${rawPhone}) and PIN: ${pin}\n` +
      `Please change your PIN after your first login.`
    smsSent = await sendSMS(phone233, msg)
  } catch { smsSent = false }

  return NextResponse.json({
    success: true,
    userId,
    smsSent,
    credentials: {
      phone: rawPhone,           // show the original format they typed
      initial_pin: pin,
      note: smsSent
        ? 'Login details sent by SMS. Staff logs in with phone + PIN and must change PIN on first login.'
        : 'Staff logs in with phone number + PIN. They must change PIN on first login. (SMS could not be sent — share the details manually.)',
    },
  })
}
