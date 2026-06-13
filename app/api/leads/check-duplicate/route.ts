import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

// Check if a lead with this phone/email already exists
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { phone, email } = await req.json()
  const sb = createServiceClient()
  const { data: leads } = await sb.from('leads')
    .select('id, full_name, phone, email, status, assignee:assigned_to(full_name)')
    .limit(3000)

  const norm = (p: string) => (p || '').replace(/[^0-9]/g, '')
  const pn = norm(phone)
  const variants = pn ? [pn, pn.replace(/^0/, '233'), pn.replace(/^233/, '0'), pn.replace(/^233/, '')] : []

  const match = (leads || []).find((l: any) =>
    (pn && l.phone && variants.includes(norm(l.phone))) ||
    (email && l.email && l.email.toLowerCase() === email.toLowerCase())
  )

  return NextResponse.json({ duplicate: !!match, lead: match || null })
}
