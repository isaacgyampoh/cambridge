import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN } from '@/lib/auth/pin'

export const runtime = 'nodejs'

function normPhone(p: string) {
  const digits = (p || '').replace(/[^0-9]/g, '')
  if (digits.startsWith('233')) return digits
  if (digits.startsWith('0')) return '233' + digits.slice(1)
  return digits
}

/**
 * Super admin edits a staff member: name, phone, email, and/or reset their
 * PIN (password). On a PIN reset we force must_change_pin so the staff sets
 * their own on next login.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only a super admin can edit staff.' }, { status: 403 })
  }

  const { id, full_name, phone, email, new_pin } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing staff id.' }, { status: 400 })

  const sb = createServiceClient()
  const update: any = {}

  if (full_name?.trim()) update.full_name = full_name.trim()
  if (email !== undefined) update.email = email?.trim() || null

  if (phone?.trim()) {
    const phone233 = normPhone(phone)
    if (phone233.length < 12) return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 })
    // ensure not taken by someone else
    const { data: clash } = await sb.from('profiles').select('id').eq('phone', phone233).neq('id', id).maybeSingle()
    if (clash) return NextResponse.json({ error: 'That phone number is already used by another staff member.' }, { status: 409 })
    update.phone = phone233
  }

  if (new_pin?.trim()) {
    if (!/^\d{4,6}$/.test(new_pin.trim())) return NextResponse.json({ error: 'PIN must be 4-6 digits.' }, { status: 400 })
    update.pin_hash = hashPIN(new_pin.trim())
    update.pin_set_at = new Date().toISOString()
    update.must_change_pin = true    // they set their own on next login
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const { error } = await sb.from('profiles').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Keep auth email in sync if it changed
  if (update.email) { try { await sb.auth.admin.updateUserById(id, { email: update.email }) } catch {} }

  return NextResponse.json({ success: true, pinReset: !!new_pin })
}
