import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { eligibleMarketers } from '@/lib/leads/eligibility'
import { recordAudit } from '@/lib/audit'
import { phoneVariants, resolveSource, validateRow } from '@/lib/leads/importValidation'

/**
 * Bulk lead import.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The previous import called intakeLead per row, which did the whole of
 * onboarding inline: two WhatsApp sends and an AI-generated opening message,
 * per lead, serially. Measured against this database on 27 August — 22 leads
 * in 249 seconds, 44 WhatsApp sends — that is 11.3 seconds a lead.
 *
 * The browser posts twenty at a time, so a request needed about 226 seconds
 * against a platform default of 10 to 15. The function was killed part way in.
 * Nothing was transactional, so the leads already written stayed written while
 * the browser counted the entire batch as failed. Hence "some staff receive
 * leads and some do not", and totals that never matched reality.
 *
 * ── THE SHAPE NOW ──────────────────────────────────────────────────────────
 *
 * This does only the fast, deterministic part:
 *
 *     validate → dedupe → insert → assign → record the outcome
 *
 * Every one of those is a database operation measured in milliseconds. The
 * slow part — greeting the lead — is queued and drained by the cron worker,
 * the same way SMS is.
 *
 * Every row gets an outcome and, when it is not `assigned`, a reason. A count
 * the operator is shown can always be traced to the rows behind it.
 */

export type ImportRow = {
  full_name?: string | null
  phone?: string | null
  email?: string | null
  course_interest?: string | null
  source?: string | null
  city?: string | null
  notes?: string | null
  assigned_to?: string | null
}

export type RowOutcome = 'assigned' | 'unassigned' | 'duplicate' | 'invalid' | 'failed'

export type ImportResult = {
  reference: string
  totalReceived: number
  valid: number
  invalid: number
  duplicates: number
  assigned: number
  unassigned: number
  failed: number
  status: 'complete' | 'partial'
}

export async function importLeads(opts: {
  rows: ImportRow[]
  importedBy: string
  filename?: string | null
  /** Continue an import already under way, so the browser can send in batches. */
  reference?: string | null
  /** Row number of the first row in this batch, for traceability into the file. */
  rowOffset?: number
}): Promise<ImportResult> {
  const sb = createServiceClient()
  const { rows, importedBy, rowOffset = 0 } = opts

  // ── the import record ────────────────────────────────────────────────────
  let reference = opts.reference || null
  let importId: string

  if (reference) {
    const { data } = await sb.from('lead_imports').select('id').eq('reference', reference).maybeSingle()
    if (!data) throw new Error(`Unknown import reference ${reference}`)
    importId = data.id
  } else {
    const { data: ref } = await sb.rpc('next_import_reference')
    reference = (ref as string) || `IMPORT-${Date.now()}`
    const { data: created, error } = await sb.from('lead_imports').insert({
      reference, imported_by: importedBy, filename: opts.filename || null,
    }).select('id').single()
    if (error || !created) throw new Error(`Could not start the import: ${error?.message}`)
    importId = created.id
  }

  // The candidate pool is resolved ONCE for the batch rather than per row.
  // It was one query per lead before, which at import volume is most of the
  // database traffic for information that does not change mid-batch.
  const candidates = await eligibleMarketers()
  const counts = { valid: 0, invalid: 0, duplicates: 0, assigned: 0, unassigned: 0, failed: 0 }
  const outcomes: Array<{
    import_id: string; row_number: number; lead_id: string | null
    outcome: RowOutcome; reason: string | null; payload: ImportRow
  }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = rowOffset + i + 1
    const record = (outcome: RowOutcome, reason: string | null, leadId: string | null = null) => {
      outcomes.push({ import_id: importId, row_number: rowNumber, lead_id: leadId, outcome, reason, payload: row })
    }

    // ── validate ──
    // Shared with lib/leads/importValidation.ts so the rules that decide
    // whether a real person makes it into the system are under test.
    const check = validateRow(row)
    if (!check.ok) { counts.invalid++; record('invalid', check.reason); continue }
    const { name, phone, email } = check
    counts.valid++

    try {
      // ── dedupe ──
      let existing: string | null = null
      const variants = phoneVariants(row.phone)
      if (variants.length) {
        const { data } = await sb.from('leads').select('id').in('phone', variants).limit(1).maybeSingle()
        existing = data?.id ?? null
      }
      if (!existing && email) {
        const { data } = await sb.from('leads').select('id').eq('email', email).limit(1).maybeSingle()
        existing = data?.id ?? null
      }
      if (existing) {
        counts.duplicates++
        record('duplicate', 'Already in the system', existing)
        continue
      }

      // ── insert ──
      const { data: lead, error: insErr } = await sb.from('leads').insert({
        full_name: name,
        phone, email,
        source: resolveSource(row.source),
        status: 'new',
        course_interest: row.course_interest || null,
        city: row.city || null,
        landing_source: `Imported (${reference})`,
      }).select('id').single()

      if (insErr || !lead) {
        counts.failed++
        // The real database message, kept — "failed" with no reason is a
        // number nobody can act on.
        record('failed', insErr?.message?.slice(0, 300) || 'Insert failed')
        continue
      }

      // ── assign ──
      // A named owner in the file wins, if they are genuinely eligible.
      const preferred = row.assigned_to
        && candidates.some(c => c.id === row.assigned_to)
        ? row.assigned_to : null

      let assignedTo: string | null = null

      if (preferred) {
        const { data: ok } = await sb.rpc('assign_lead_to', {
          p_lead_id: lead.id, p_marketer: preferred, p_actor: importedBy,
          p_reason: 'import', p_source: reference, p_force: false,
        })
        if (ok) assignedTo = preferred
      }

      if (!assignedTo && candidates.length) {
        const { data: chosen, error: assignErr } = await sb.rpc('assign_lead_atomic', {
          p_lead_id: lead.id,
          p_candidates: candidates.map(c => c.id),
          p_weights: candidates.map(c => c.weight),
          p_actor: importedBy, p_reason: 'import', p_source: reference, p_force: false,
        })
        if (assignErr) {
          // The lead exists and is safe; only its owner is missing.
          counts.unassigned++
          record('unassigned', `Assignment failed: ${assignErr.message.slice(0, 200)}`, lead.id)
          continue
        }
        assignedTo = (chosen as string) || null
      }

      if (!assignedTo) {
        counts.unassigned++
        record('unassigned',
          candidates.length ? 'No marketer could be selected' : 'Nobody currently holds the Leads access',
          lead.id)
        continue
      }

      counts.assigned++
      record('assigned', null, lead.id)

      // ── queue the greeting ──
      // Two WhatsApp sends and an AI call. Inline, this was 11 seconds a lead
      // and the reason imports timed out. Unique index on lead_id means a
      // re-import cannot greet the same person twice.
      await sb.from('lead_onboarding_queue').insert({
        lead_id: lead.id, marketer_id: assignedTo,
        source: 'import', import_ref: reference,
      }).then(() => {}, () => { /* already queued; that is the point */ })

    } catch (e) {
      counts.failed++
      record('failed', e instanceof Error ? e.message.slice(0, 300) : 'Unexpected error')
    }
  }

  if (outcomes.length) {
    const { error } = await sb.from('lead_import_rows').insert(outcomes)
    if (error) console.error(`[import ${reference}] could not record row outcomes:`, error.message)
  }

  // Counters are incremented, not overwritten, so batched calls accumulate.
  const { data: current } = await sb.from('lead_imports')
    .select('total_received, valid, invalid, duplicates, assigned, unassigned, failed')
    .eq('id', importId).maybeSingle()

  const prev = current || {
    total_received: 0, valid: 0, invalid: 0, duplicates: 0, assigned: 0, unassigned: 0, failed: 0,
  }
  const totals = {
    total_received: prev.total_received + rows.length,
    valid: prev.valid + counts.valid,
    invalid: prev.invalid + counts.invalid,
    duplicates: prev.duplicates + counts.duplicates,
    assigned: prev.assigned + counts.assigned,
    unassigned: prev.unassigned + counts.unassigned,
    failed: prev.failed + counts.failed,
  }
  const status = (totals.failed > 0 || totals.unassigned > 0) ? 'partial' : 'complete'

  await sb.from('lead_imports').update({
    ...totals, status, finished_at: new Date().toISOString(),
  }).eq('id', importId)

  await recordAudit({
    actorId: importedBy,
    action: 'leads.imported',
    resource: 'lead_imports',
    resourceId: importId,
    success: counts.failed === 0,
    metadata: { reference, batch: rows.length, ...counts },
  })

  return {
    reference: reference!,
    totalReceived: totals.total_received,
    valid: totals.valid,
    invalid: totals.invalid,
    duplicates: totals.duplicates,
    assigned: totals.assigned,
    unassigned: totals.unassigned,
    failed: totals.failed,
    status,
  }
}
