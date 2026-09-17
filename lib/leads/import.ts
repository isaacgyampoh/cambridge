import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { eligibleMarketers } from '@/lib/leads/eligibility'
import { distributeLead } from '@/lib/leads/distributionStore'
import { notifyImportBatch } from '@/lib/leads/importNotify'
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
  /** False when the run could not be catalogued; the leads still landed. */
  tracked: boolean
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

  /*
   * THE IMPORT'S JOB IS TO CREATE LEADS. CATALOGUING THE RUN IS SECONDARY.
   *
   * This used to throw before a single lead was looked at if lead_imports was
   * unavailable — the table and the next_import_reference function both come
   * from migration 0011, and migrations here are applied by hand. The whole
   * upload then failed with "The import could not be started", which tells
   * the person holding a spreadsheet of real enquiries nothing they can act
   * on and loses every row.
   *
   * So the catalogue is attempted, and when it cannot be written the import
   * carries on without it. The leads — the thing of value — still land. The
   * result says tracking was unavailable so nobody is misled into looking for
   * a run record that was never created.
   */
  let trackingAvailable = true

  if (reference) {
    const { data, error } = await sb.from('lead_imports')
      .select('id').eq('reference', reference).maybeSingle()
    if (error) {
      trackingAvailable = false
      importId = ''
    } else if (!data) {
      throw new Error(`Unknown import reference ${reference}`)
    } else {
      importId = data.id
    }
  } else {
    const { data: ref } = await sb.rpc('next_import_reference')
    reference = (ref as string) || `IMPORT-${Date.now()}`
    const { data: created, error } = await sb.from('lead_imports').insert({
      reference, imported_by: importedBy, filename: opts.filename || null,
    }).select('id').single()
    if (error || !created) {
      console.error('[import] the run could not be catalogued; importing anyway:', error?.message)
      trackingAvailable = false
      importId = ''
    } else {
      importId = created.id
    }
  }

  // The candidate pool is resolved ONCE for the batch rather than per row.
  // It was one query per lead before, which at import volume is most of the
  // database traffic for information that does not change mid-batch.
  const candidates = await eligibleMarketers()
  const counts = { valid: 0, invalid: 0, duplicates: 0, assigned: 0, unassigned: 0, failed: 0 }

  /*
   * Who received how many in THIS batch, so the people involved can be told
   * once at the end rather than once per row. Imported leads used to be
   * assigned and announced to nobody at all.
   */
  const assignedTally = new Map<string, number>()
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
        /*
         * An imported lead with no owner named in the file enters the SAME
         * shared pool as one arriving from a form or a webhook. It used to go
         * through assign_lead_atomic — the old least-loaded rule — so a bulk
         * import ignored the configured percentages entirely and could undo a
         * carefully set split in a single upload.
         */
        const outcome = await distributeLead(lead.id, candidates, { source: 'import' })
        if (outcome.failure) {
          // The lead exists and is safe; only its owner is missing.
          counts.unassigned++
          record('unassigned', `Assignment failed: ${outcome.failure.slice(0, 200)}`, lead.id)
          continue
        }
        assignedTo = outcome.chosen
      }

      if (!assignedTo) {
        counts.unassigned++
        record('unassigned',
          candidates.length ? 'No marketer could be selected' : 'Nobody currently holds the Leads access',
          lead.id)
        continue
      }

      counts.assigned++
      assignedTally.set(assignedTo, (assignedTally.get(assignedTo) || 0) + 1)
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
    if (trackingAvailable) {
      const { error } = await sb.from('lead_import_rows').insert(outcomes)
      if (error) console.error(`[import ${reference}] could not record row outcomes:`, error.message)
    }
  }

  /*
   * Counters are incremented, not overwritten, so batched calls accumulate.
   * With no catalogue row there is nothing to accumulate onto, and querying
   * `.eq('id', '')` against a uuid column is itself an error — so this batch's
   * own counts stand as the result.
   */
  const { data: current } = trackingAvailable
    ? await sb.from('lead_imports')
        .select('total_received, valid, invalid, duplicates, assigned, unassigned, failed')
        .eq('id', importId).maybeSingle()
    : { data: null }

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

  if (trackingAvailable) {
    await sb.from('lead_imports').update({
      ...totals, status, finished_at: new Date().toISOString(),
    }).eq('id', importId)
  }

  /*
   * Announced only now, when every row is committed. One message per person
   * covering the whole batch — a marketer given forty leads from one upload
   * gets one text, not forty.
   *
   * Nothing here can affect the import: the leads exist either way, and a
   * failed channel is logged and reported rather than thrown.
   */
  const notified = await notifyImportBatch(assignedTally, reference!)

  await recordAudit({
    actorId: importedBy,
    action: 'leads.imported',
    resource: 'lead_imports',
    resourceId: importId || undefined,
    success: counts.failed === 0,
    metadata: { reference, batch: rows.length, ...counts, notified },
  })

  return {
    reference: reference!,
    /*
     * Reported so the screen can say the rows landed but the run was not
     * catalogued, rather than leaving somebody hunting for an import record
     * that was never written.
     */
    tracked: trackingAvailable,
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
