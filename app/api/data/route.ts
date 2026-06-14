import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

// Universal data endpoint — bypasses RLS using service role
// Pages call: /api/data?table=payments&select=*,student:student_id(full_name)&limit=100
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const table = searchParams.get('table')
  const select = searchParams.get('select') || '*'
  const limit = parseInt(searchParams.get('limit') || '200')
  const orderBy = searchParams.get('orderBy') || 'created_at'
  const orderAsc = searchParams.get('orderAsc') === 'true'
  const filters = searchParams.get('filters') // JSON encoded filter array

  if (!table) return NextResponse.json({ error: 'Missing table' }, { status: 400 })

  // Role-based table access control
  const ALLOWED: Record<string, string[]> = {
    super_admin: ['*'],
    project_manager: ['leads','lead_activities','lead_status_logs','profiles','notifications','admissions','batches','courses','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    marketing_officer: ['leads','lead_activities','lead_status_logs','notifications','follow_up_queue','applications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    admissions_officer: ['admissions','applications','leads','profiles','courses','batches','notifications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    accountant: ['payments','invoices','applications','profiles','courses','notifications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    receptionist: ['batches','batch_students','profiles','courses','class_sessions','class_signins','notifications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    trainer: ['batches','batch_students','attendance','profiles','courses','class_sessions','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    student: ['invoices','payments','batch_students','batches','courses','attendance','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
  }

  const allowed = ALLOWED[session.role || ''] || []
  if (!allowed.includes('*') && !allowed.includes(table)) {
    return NextResponse.json({ error: 'Access denied to this table' }, { status: 403 })
  }

  const sb = createServiceClient()
  let query: any = sb.from(table).select(select).limit(limit)

  if (orderBy) query = query.order(orderBy, { ascending: orderAsc })

  // Apply filters: [{col, op, val}]
  if (filters) {
    try {
      const f = JSON.parse(filters)
      for (const { col, op, val } of f) {
        if (op === 'eq') query = query.eq(col, val)
        else if (op === 'neq') query = query.neq(col, val)
        else if (op === 'is_null') query = query.is(col, null)
        else if (op === 'gte') query = query.gte(col, val)
        else if (op === 'lte') query = query.lte(col, val)
        else if (op === 'in') query = query.in(col, val)
        else if (op === 'ilike') query = query.ilike(col, `%${val}%`)
      }
    } catch {}
  }

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data || [], count })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { table, data, upsert, onConflict } = await req.json()
  if (!table || !data) return NextResponse.json({ error: 'Missing table or data' }, { status: 400 })

  const sb = createServiceClient()
  const { data: result, error } = upsert
    ? await sb.from(table).upsert(data, { onConflict }).select()
    : await sb.from(table).insert(data).select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: result })
}

export async function PATCH(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { table, data, filters } = await req.json()
  if (!table || !data || !filters) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const sb = createServiceClient()
  let query: any = sb.from(table).update(data)
  for (const { col, val } of filters) { query = query.eq(col, val) }
  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { table, filters } = await req.json()
  if (!table || !filters?.length) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const ALLOWED: Record<string, string[]> = {
    super_admin: ['*'],
    project_manager: ['leads','lead_activities','lead_status_logs','profiles','notifications','admissions','batches','courses','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    marketing_officer: ['leads','lead_activities','lead_status_logs','notifications','follow_up_queue','applications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    admissions_officer: ['admissions','applications','leads','profiles','courses','batches','notifications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    accountant: ['payments','invoices','applications','profiles','courses','notifications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    receptionist: ['batches','batch_students','profiles','courses','class_sessions','class_signins','notifications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    trainer: ['batches','batch_students','attendance','profiles','courses','class_sessions','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
    student: ['invoices','payments','batch_students','batches','courses','attendance','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','notifications','program_points','rank_bands','marketer_enrollments'],
  }
  const allowed = ALLOWED[session.role || ''] || []
  if (!allowed.includes('*') && !allowed.includes(table)) {
    return NextResponse.json({ error: 'Access denied to this table' }, { status: 403 })
  }

  const sb = createServiceClient()
  let query: any = sb.from(table).delete()
  for (const { col, val } of filters) { query = query.eq(col, val) }
  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
