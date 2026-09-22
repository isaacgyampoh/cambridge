import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'
import { saveFailed } from '@/lib/db/lookup'
import { normaliseWasenderKey, describeSessionStatus, keyFingerprint } from '@/lib/whatsapp/wasenderRules'
import { sessionStatus, credentialFor, recordLineStatus } from '@/lib/whatsapp/wasender'

export const runtime = 'nodejs'

/**
 * A person's own WhatsApp line: its WasenderAPI session key and number.
 *
 *   POST { staffId?, apiKey?, number? }  save — the key is VERIFIED first
 *   PUT  { staffId? }                    re-check the line's live status
 *
 * ── WHAT CHANGED ───────────────────────────────────────────────────────────
 *
 * The key was stored exactly as pasted, and the screen sent status:
 * 'connecting' with it — so every newly saved line showed Connecting until a
 * test message happened to succeed, whatever WasenderAPI actually said.
 * The test then sent a WhatsApp message to the line's own number and
 * reported WasenderAPI's raw reply, which for a rejected key is
 * "invalid API key".
 *
 * Now the key is cleaned of what a paste drags along, checked against
 * GET /api/status before it is saved, and refused with the actual reason if
 * WasenderAPI does not accept it — including the specific case of a Personal
 * Access Token pasted where the session key belongs. The status stored is the
 * one WasenderAPI returned. The browser can no longer set it.
 */

const MANAGERS = ['super_admin', 'project_manager']

async function session(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return null
  const s = await verifySession(token)
  return s.valid ? s : null
}

function targetFor(s: { userId?: string; role?: string }, staffId?: string | null): string | NextResponse {
  const target = staffId && staffId !== s.userId ? staffId : (s.userId as string)
  if (target !== s.userId && !MANAGERS.includes(s.role || '')) {
    return NextResponse.json({ error: 'You can only manage your own WhatsApp line.' }, { status: 403 })
  }
  return target
}

export async function POST(req: NextRequest) {
  const s = await session(req)
  if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { staffId, apiKey, number } = await req.json().catch(() => ({}))
  const target = targetFor(s, staffId)
  if (target instanceof NextResponse) return target

  const update: Record<string, unknown> = {}
  if (number !== undefined) update.wasender_phone = String(number || '').trim() || null

  let verified: { label: string; action: string; status: string } | null = null

  if (apiKey !== undefined && String(apiKey).trim() !== '') {
    const key = normaliseWasenderKey(apiKey)
    if (key.length < 20) {
      return NextResponse.json({ error: 'That does not look like a WasenderAPI key — it is too short. Copy the API key from the WhatsApp session’s page in WasenderAPI.' }, { status: 400 })
    }

    const live = await sessionStatus(key)

    // A key WasenderAPI refuses is not saved: storing it would only turn the
    // next message into another "invalid API key".
    if (!live.ok && (live.kind === 'auth' || live.kind === 'personal_access_token')) {
      return NextResponse.json({ error: live.message, kind: live.kind }, { status: 400 })
    }

    update.wasender_api_key = key
    if (live.ok) {
      update.wasender_status = live.status
      const d = describeSessionStatus(live.status)
      verified = { status: live.status, label: d.label, action: d.action }
    }
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
  }

  const sb = createServiceClient()
  const { error } = await sb.from('profiles').update(update).eq('id', target)
  if (error) return saveFailed('[whatsapp/instance]', error.message, 'that connection')

  return NextResponse.json({
    success: true,
    status: verified?.status ?? null,
    label: verified?.label ?? null,
    message: verified
      ? `Saved. WasenderAPI reports this line as ${verified.label}. ${verified.action}`
      : 'Saved. WasenderAPI could not be reached to confirm the line — check it again in a moment.',
    key: update.wasender_api_key ? keyFingerprint(update.wasender_api_key as string) : undefined,
  })
}

export async function PUT(req: NextRequest) {
  const s = await session(req)
  if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { staffId } = await req.json().catch(() => ({}))
  const target = targetFor(s, staffId)
  if (target instanceof NextResponse) return target

  const cred = await credentialFor(target)
  if ('error' in cred) return NextResponse.json({ success: false, error: cred.error }, { status: 400 })

  const live = await sessionStatus(cred.key)
  await recordLineStatus(target, live)

  if (!live.ok) {
    return NextResponse.json({ success: false, kind: live.kind, error: live.message, http: live.http })
  }
  const d = describeSessionStatus(live.status)
  return NextResponse.json({
    success: live.status === 'connected',
    status: live.status, label: d.label, message: d.action,
  })
}
