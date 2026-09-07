import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSession, GuardError } from '@/lib/auth/guard'
import { recordAudit } from '@/lib/audit'
import {
  canRead, canWrite, canDelete, ownerColumnFor, isValidIdentifier,
  embeddedRelations, FK_TARGETS, scrubRow,
  SECRET_COLUMNS, MONEY_COLUMNS, ROLES_THAT_SEE_MONEY, UNWRITABLE_COLUMNS,
} from '@/lib/data/policy'

export const runtime = 'nodejs'

/**
 * Generic data endpoint.
 *
 * This runs client-supplied queries with the service role, which bypasses RLS,
 * so every request is checked against lib/data/policy.ts. It should eventually
 * be replaced by typed per-resource endpoints; until then the policy module is
 * the single place these rules live.
 */

const MAX_LIMIT = 500

type Filter = { col: string; op?: string; val?: unknown }

/** Filters come from the browser, so both the column and operator are checked. */
function parseFilters(raw: string | null): Filter[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((f: Filter) => f && typeof f.col === 'string' && isValidIdentifier(f.col))
  } catch {
    return []
  }
}

const ALLOWED_OPS = new Set(['eq', 'neq', 'is_null', 'gte', 'lte', 'gt', 'lt', 'in', 'ilike'])

function fail(message: string, status = 403) {
  return NextResponse.json({ error: message }, { status })
}

/** Refuse a select string that reaches tables the role may not read. */
function checkSelect(select: string, role: string, portals: string[]): string | null {
  if (select.length > 2000) return 'That query is too complex.'
  for (const rel of embeddedRelations(select)) {
    const target = FK_TARGETS[rel] || rel
    if (!isValidIdentifier(target)) return 'That query is not valid.'
    if (!canRead(target, role, portals)) {
      return 'You do not have access to some of the information in that request.'
    }
  }
  return null
}

export async function GET(req: NextRequest) {
  let ctx
  try { ctx = await requireSession(req) } catch (e) { return (e as GuardError).response }
  const role = ctx.session.role
  const userId = ctx.session.userId
  /*
   * The user's RESOLVED portals, not their role's defaults.
   *
   * Lead access is derived from the `my_leads` portal (see lib/data/policy),
   * and an administrator can grant that to one person from the staff screen.
   * Reading it off the session means such a grant actually works instead of
   * making them a lead recipient whose reads are refused.
   */
  const portals = ctx.portals

  const { searchParams } = req.nextUrl
  const table = searchParams.get('table') || ''
  const select = searchParams.get('select') || '*'

  if (!table || !isValidIdentifier(table)) return fail('Missing or invalid table.', 400)
  if (!canRead(table, role, portals)) return fail('You do not have access to this information.')

  const selectError = checkSelect(select, role, portals)
  if (selectError) return fail(selectError)

  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '200', 10) || 200, 1), MAX_LIMIT)
  const orderBy = searchParams.get('orderBy') || 'created_at'
  const orderAsc = searchParams.get('orderAsc') === 'true'

  const sb = createServiceClient()
  let query = sb.from(table).select(select).limit(limit)

  // Row scoping is applied regardless of the filters the caller sent.
  const ownerCol = ownerColumnFor(table, role, portals)
  if (ownerCol) query = query.eq(ownerCol, userId)

  if (orderBy && isValidIdentifier(orderBy)) {
    query = query.order(orderBy, { ascending: orderAsc })
  }

  for (const { col, op = 'eq', val } of parseFilters(searchParams.get('filters'))) {
    if (!ALLOWED_OPS.has(op)) continue
    // A caller must not widen their own scope by filtering on the owner column.
    if (ownerCol && col === ownerCol) continue
    if (op === 'eq') query = query.eq(col, val)
    else if (op === 'neq') query = query.neq(col, val)
    else if (op === 'is_null') query = query.is(col, null)
    else if (op === 'gte') query = query.gte(col, val)
    else if (op === 'lte') query = query.lte(col, val)
    else if (op === 'gt') query = query.gt(col, val)
    else if (op === 'lt') query = query.lt(col, val)
    else if (op === 'in' && Array.isArray(val)) query = query.in(col, val)
    else if (op === 'ilike') query = query.ilike(col, `%${String(val)}%`)
  }

  const { data, error, count } = await query
  if (error) {
    console.error(`[data] select on ${table} failed:`, error.message)
    return NextResponse.json({ error: 'Could not load that information. Please try again.' }, { status: 500 })
  }

  // Credentials are stripped for EVERY role, including super admin, and from
  // nested embeds as well as top-level rows.
  let rows = scrubRow(data || [], SECRET_COLUMNS) as unknown[]
  if (!ROLES_THAT_SEE_MONEY.includes(role)) {
    rows = scrubRow(rows, MONEY_COLUMNS) as unknown[]
  }

  return NextResponse.json({ data: rows, count })
}

export async function POST(req: NextRequest) {
  let ctx
  try { ctx = await requireSession(req) } catch (e) { return (e as GuardError).response }
  const role = ctx.session.role
  const portals = ctx.portals

  const body = await req.json().catch(() => null)
  if (!body?.table || body.data === undefined) return fail('Missing table or data.', 400)

  const table = String(body.table)
  if (!isValidIdentifier(table)) return fail('Invalid table.', 400)
  if (!canWrite(table, role, portals)) return fail('You do not have permission to add to this.')

  const rows = Array.isArray(body.data) ? body.data : [body.data]
  for (const row of rows) {
    const blocked = Object.keys(row || {}).find(k => UNWRITABLE_COLUMNS.includes(k))
    if (blocked) return fail(`The field "${blocked}" cannot be set here.`, 400)
  }

  const sb = createServiceClient()
  const { data: result, error } = body.upsert
    ? await sb.from(table).upsert(body.data, { onConflict: body.onConflict }).select()
    : await sb.from(table).insert(body.data).select()

  if (error) {
    console.error(`[data] insert into ${table} failed:`, error.message)
    return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 })
  }

  await recordAudit({
    actorId: ctx.session.userId,
    action: body.upsert ? 'data.upsert' : 'data.insert',
    resource: table,
    success: true,
    metadata: { rows: rows.length },
    request: req,
  })

  return NextResponse.json({ data: scrubRow(result, SECRET_COLUMNS) })
}

export async function PATCH(req: NextRequest) {
  let ctx
  try { ctx = await requireSession(req) } catch (e) { return (e as GuardError).response }
  const role = ctx.session.role
  const userId = ctx.session.userId
  /*
   * The user's RESOLVED portals, not their role's defaults.
   *
   * Lead access is derived from the `my_leads` portal (see lib/data/policy),
   * and an administrator can grant that to one person from the staff screen.
   * Reading it off the session means such a grant actually works instead of
   * making them a lead recipient whose reads are refused.
   */
  const portals = ctx.portals

  const body = await req.json().catch(() => null)
  if (!body?.table || !body.data || !body.filters) return fail('Missing table, data or filters.', 400)

  const table = String(body.table)
  if (!isValidIdentifier(table)) return fail('Invalid table.', 400)
  if (!canWrite(table, role, portals)) return fail('You do not have permission to change this.')

  const blocked = Object.keys(body.data).find(k => UNWRITABLE_COLUMNS.includes(k))
  if (blocked) return fail(`The field "${blocked}" cannot be changed here.`, 400)

  const filters: Filter[] = Array.isArray(body.filters) ? body.filters : []
  if (!filters.length) return fail('An update must say which rows to change.', 400)
  if (filters.some(f => !isValidIdentifier(String(f.col)))) return fail('Invalid filter.', 400)

  const sb = createServiceClient()
  let query = sb.from(table).update(body.data)

  // Scope the update to rows this user owns, where the table calls for it.
  const ownerCol = ownerColumnFor(table, role, portals)
  if (ownerCol) query = query.eq(ownerCol, userId)

  for (const { col, val } of filters) {
    if (ownerCol && col === ownerCol) continue
    query = query.eq(col, val)
  }

  const { error } = await query
  if (error) {
    console.error(`[data] update on ${table} failed:`, error.message)
    return NextResponse.json({ error: 'Could not save that change. Please try again.' }, { status: 500 })
  }

  await recordAudit({
    actorId: userId,
    action: 'data.update',
    resource: table,
    success: true,
    metadata: { fields: Object.keys(body.data), filters: filters.map(f => f.col) },
    request: req,
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  let ctx
  try { ctx = await requireSession(req) } catch (e) { return (e as GuardError).response }
  const role = ctx.session.role
  const userId = ctx.session.userId
  /*
   * The user's RESOLVED portals, not their role's defaults.
   *
   * Lead access is derived from the `my_leads` portal (see lib/data/policy),
   * and an administrator can grant that to one person from the staff screen.
   * Reading it off the session means such a grant actually works instead of
   * making them a lead recipient whose reads are refused.
   */
  const portals = ctx.portals

  const body = await req.json().catch(() => null)
  if (!body?.table || !body.filters?.length) return fail('Missing table or filters.', 400)

  const table = String(body.table)
  if (!isValidIdentifier(table)) return fail('Invalid table.', 400)
  if (!canDelete(table, role)) return fail('You do not have permission to delete this.')

  const filters: Filter[] = body.filters
  if (filters.some(f => !isValidIdentifier(String(f.col)))) return fail('Invalid filter.', 400)

  const sb = createServiceClient()
  let query = sb.from(table).delete()

  const ownerCol = ownerColumnFor(table, role, portals)
  if (ownerCol) query = query.eq(ownerCol, userId)
  for (const { col, val } of filters) {
    if (ownerCol && col === ownerCol) continue
    query = query.eq(col, val)
  }

  const { error } = await query
  if (error) {
    console.error(`[data] delete on ${table} failed:`, error.message)
    return NextResponse.json({ error: 'Could not delete that. Please try again.' }, { status: 500 })
  }

  await recordAudit({
    actorId: userId,
    action: 'data.delete',
    resource: table,
    success: true,
    metadata: { filters: filters.map(f => f.col) },
    request: req,
  })

  return NextResponse.json({ success: true })
}
