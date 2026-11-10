import { NextRequest, NextResponse } from 'next/server'
import { isValidPin, PIN_LENGTH } from '@/lib/auth/pinPolicy'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN } from '@/lib/auth/pin'
import { saveFailed } from '@/lib/db/lookup'
import { canonicalGhanaMobile } from '@/lib/phone'

export const runtime = 'nodejs'

/*
 * The staff phone is the address a PIN reset and a sign-in code are sent to,
 * so what is stored here has to be what the sender can read.
 *
 * This had its own rule, and it did not validate: anything already starting
 * 233 was stored verbatim, so "+233 (0) 244 721 555" went in as
 * 2330244721555 — thirteen digits, past the length check below, and refused
 * by every reader afterwards. The person could be edited, listed and given a
 * PIN, and could never be texted one.
 */

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
    const phone233 = canonicalGhanaMobile(phone)
    if (!phone233) {
      return NextResponse.json({
        error: 'Enter a Ghanaian mobile number, such as 0244721555. '
          + 'This is where their PIN and sign-in codes are sent.',
      }, { status: 400 })
    }
    // ensure not taken by someone else
    const { data: clash } = await sb.from('profiles').select('id').eq('phone', phone233).neq('id', id).maybeSingle()
    if (clash) return NextResponse.json({ error: 'That phone number is already used by another staff member.' }, { status: 409 })
    update.phone = phone233
  }

  if (new_pin?.trim()) {
    if (!isValidPin(new_pin.trim())) {
      return NextResponse.json(
        { error: `A PIN must be exactly ${PIN_LENGTH} digits.` }, { status: 400 })
    }
    update.pin_hash = hashPIN(new_pin.trim())
    update.pin_set_at = new Date().toISOString()
    update.must_change_pin = true    // they set their own on next login
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const { error } = await sb.from('profiles').update(update).eq('id', id)
  if (error) return saveFailed('[admin/edit-staff]', error.message, 'those changes')

  // Keep auth email in sync if it changed
  if (update.email) { try { await sb.auth.admin.updateUserById(id, { email: update.email }) } catch {} }

  return NextResponse.json({ success: true, pinReset: !!new_pin })
}
