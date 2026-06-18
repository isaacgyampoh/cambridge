import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

export async function POST(req: NextRequest) {
  const { batchId, name, lat, lng, joiningOnline } = await req.json()
  if (!batchId || !name) return NextResponse.json({ error: 'Missing details' }, { status: 400 })

  const sb = createServiceClient()

  // Class info (incl. the Zoom link set per class on the batch)
  const { data: batch } = await sb.from('batches').select('id, name, zoom_link').eq('id', batchId).maybeSingle()

  const { data: roster } = await sb.from('class_enrollments')
    .select('id, full_name, phone, total_fee, amount_paid, balance, application_id, application:application_id(delivery)')
    .eq('batch_id', batchId).eq('status', 'active')
  const q = name.toLowerCase().trim()
  const match = (roster || []).find((s: any) => (s.full_name || '').toLowerCase().trim() === q) ||
    (roster || []).find((s: any) => (s.full_name || '').toLowerCase().includes(q))
  if (!match) {
    return NextResponse.json({ error: 'name_not_found', message: "We couldn't find your name on this class list. Please check the spelling or see the desk." }, { status: 404 })
  }

  // Is this student registered as an online student?
  const registeredOnline = (match as any).application?.delivery === 'online'

  let atVenue = false
  if (typeof lat === 'number' && typeof lng === 'number') {
    const { data: offices } = await sb.from('office_locations').select('latitude, longitude, radius_meters')
    if (offices?.length) {
      for (const o of offices) {
        const dist = distanceMeters(lat, lng, Number(o.latitude), Number(o.longitude))
        if (dist <= (o.radius_meters || 150)) { atVenue = true; break }
      }
    }
  }

  // Decide the mode:
  //  - Registered online students are always online (get the Zoom link).
  //  - In-person students at the venue -> in_person.
  //  - In-person students NOT at the venue -> only if they choose online,
  //    then they switch to online (and get the Zoom link).
  let mode: 'in_person' | 'online'
  if (registeredOnline) {
    mode = 'online'
  } else if (atVenue) {
    mode = 'in_person'
  } else if (joiningOnline) {
    mode = 'online'
  } else {
    return NextResponse.json({ error: 'not_in_class', message: "You don't appear to be at the class venue. If you're joining online today, choose that option and we'll switch you over.", canJoinOnline: true }, { status: 403 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data: existing } = await sb.from('class_signins')
    .select('id').eq('enrollment_id', match.id).eq('session_date', today).maybeSingle()
  if (!existing) {
    await sb.from('class_signins').insert({
      batch_id: batchId, enrollment_id: match.id,
      student_name: match.full_name, phone: match.phone, session_date: today,
    })
  }

  // If an in-person student switched to online, flip their delivery
  if (mode === 'online' && !registeredOnline && match.application_id) {
    await sb.from('applications').update({ delivery: 'online' }).eq('id', match.application_id).then(() => {}, () => {})
  }

  const balance = Number(match.balance ?? ((match.total_fee || 0) - (match.amount_paid || 0))) || 0

  return NextResponse.json({
    success: true,
    mode,
    switched: mode === 'online' && !registeredOnline,
    zoomLink: mode === 'online' ? (batch?.zoom_link || null) : null,
    enrollmentId: match.id,
    studentName: match.full_name,
    totalFee: match.total_fee || 0,
    amountPaid: match.amount_paid || 0,
    balance,
    allowCash: mode === 'in_person',  // online students pay MoMo/bank only
  })
}
