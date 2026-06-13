import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

// Haversine distance in metres
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { action, lat, lng } = await req.json()  // action: 'in' | 'out'
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'Location is required. Please allow location access and try again.' }, { status: 400 })
  }

  const sb = createServiceClient()

  // Find nearest active office
  const { data: offices } = await sb.from('office_locations').select('*').eq('is_active', true)
  if (!offices?.length) {
    return NextResponse.json({ error: 'No office location has been set up yet. Ask your administrator to configure it.' }, { status: 400 })
  }

  let nearest = offices[0]
  let nearestDist = distanceMeters(lat, lng, Number(offices[0].latitude), Number(offices[0].longitude))
  for (const o of offices.slice(1)) {
    const d = distanceMeters(lat, lng, Number(o.latitude), Number(o.longitude))
    if (d < nearestDist) { nearest = o; nearestDist = d }
  }

  const allowed = nearestDist <= (nearest.radius_meters || 150)
  if (!allowed) {
    return NextResponse.json({
      error: `You are ${nearestDist} m from ${nearest.name}. You must be within ${nearest.radius_meters} m of the office to sign in.`,
      distance: nearestDist,
      denied: true,
    }, { status: 403 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()

  // Existing record for today?
  const { data: existing } = await sb.from('staff_attendance')
    .select('*').eq('staff_id', session.userId).eq('date', today).maybeSingle()

  if (action === 'out') {
    if (!existing) return NextResponse.json({ error: 'You have not clocked in today.' }, { status: 400 })
    await sb.from('staff_attendance').update({
      clock_out_at: now, clock_out_lat: lat, clock_out_lng: lng,
    }).eq('id', existing.id)
    return NextResponse.json({ success: true, action: 'out', office: nearest.name, distance: nearestDist })
  }

  // Clock in
  if (existing?.clock_in_at) {
    return NextResponse.json({ error: 'You have already clocked in today.', alreadyIn: true }, { status: 400 })
  }

  // Late if after 9:00 local
  const hour = new Date().getHours()
  const status = hour >= 9 ? 'late' : 'present'

  await sb.from('staff_attendance').upsert({
    staff_id: session.userId,
    date: today,
    clock_in_at: now,
    clock_in_lat: lat,
    clock_in_lng: lng,
    office_id: nearest.id,
    distance_meters: nearestDist,
    status,
  }, { onConflict: 'staff_id,date' })

  return NextResponse.json({ success: true, action: 'in', office: nearest.name, distance: nearestDist, status })
}
