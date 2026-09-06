import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { importLeads, type ImportRow } from '@/lib/leads/import'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * Bulk lead import.
 *
 * 60 seconds is a ceiling, not a target: the work here is now database-only,
 * so a batch of fifty should finish in well under a second. It is declared
 * because the previous route declared nothing and inherited the platform
 * default of 10 to 15 seconds — which, doing two WhatsApp sends per lead
 * inline, it exceeded on the second or third row and was killed. The leads
 * written before the kill stayed written and the browser reported the whole
 * batch as failed.
 */
export const maxDuration = 60

const Row = z.object({
  full_name: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  course_interest: z.string().trim().max(200).optional().nullable(),
  source: z.string().trim().max(40).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
})

const Body = z.object({
  leads: z.array(Row).min(1, 'Send at least one row').max(200, 'Send at most 200 rows per request'),
  /** Continues an import already under way, so batches accumulate into one record. */
  reference: z.string().trim().max(60).optional().nullable(),
  filename: z.string().trim().max(260).optional().nullable(),
  /** Where this batch starts in the original file, so row numbers stay true. */
  rowOffset: z.number().int().min(0).max(1_000_000).optional(),
})

export const POST = withGuard({ portals: ['leads', 'pm_leads'] }, async (req: NextRequest, { session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'That import could not be read.' },
      { status: 400 }
    )
  }

  const { leads, reference, filename, rowOffset } = parsed.data

  try {
    const result = await importLeads({
      rows: leads as ImportRow[],
      importedBy: session.userId,
      filename: filename ?? null,
      reference: reference ?? null,
      rowOffset: rowOffset ?? 0,
    })

    // The reference goes back so the browser can send the next batch into the
    // same import, and so the operator has a handle to trace it by afterwards.
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    console.error('[leads/import] failed:', e)
    return NextResponse.json(
      { error: 'The import could not be started. Please try again.' },
      { status: 500 }
    )
  }
})
