import { repriceTo, round2, type FeeState } from './reprice.ts'
import type { ClassMode } from '../classMode.ts'

/**
 * Re-pricing a whole programme, after its fee has been corrected.
 *
 * ── WHY THIS IS NEEDED AT ALL ──────────────────────────────────────────────
 *
 * student_fees.total_fee is a snapshot taken at registration. Correcting the
 * course does not move it — deliberately — so after a price list is fixed,
 * every student already registered still holds the old figure, and each one
 * has to be corrected by hand. With a few students that is fine. With a
 * cohort it is not, and the realistic outcome is that it never gets done and
 * the portal goes on quoting prices the centre abandoned.
 *
 * ── AND WHY IT PLANS BEFORE IT ACTS ────────────────────────────────────────
 *
 * This is the most dangerous operation in the product: it changes what a
 * roomful of people owe, in one click, and the people affected find out by
 * receiving a different number. So the plan is computed first and shown — who
 * changes, from what to what, and what it does to the total owed — and
 * nothing is written until that exact plan is confirmed.
 *
 * Money already received is never part of it. The balance is recomputed from
 * what each student has actually paid.
 */

export type FeeRow = {
  id: string
  student_name?: string | null
  delivery?: string | null
  total_fee?: unknown
  amount_paid?: unknown
}

export type PlannedChange = {
  id: string
  student: string
  from: number
  to: number
  amountPaid: number
  balance: number
  status: FeeState['status']
  /** True when the correction leaves the student having overpaid. */
  inCredit: boolean
}

export type SkippedRow = {
  id: string
  student: string
  why: string
}

export type BulkPlan = {
  changes: PlannedChange[]
  skipped: SkippedRow[]
  /** What the change does to the total owed across everybody in the plan. */
  owedBefore: number
  owedAfter: number
  /** Students who end up having paid more than they owe. */
  creditCount: number
}

/**
 * Work out what would change, without changing anything.
 *
 * `feeForMode` is passed in rather than computed here so the caller supplies
 * the one rule the rest of the application uses, instead of this file growing
 * a second opinion about what a programme costs.
 */
export function planBulkReprice(
  rows: FeeRow[],
  feeForMode: (mode: ClassMode) => number,
  parseMode: (v: unknown) => ClassMode | null,
): BulkPlan {
  const changes: PlannedChange[] = []
  const skipped: SkippedRow[] = []
  let owedBefore = 0
  let owedAfter = 0

  for (const row of rows || []) {
    const student = String(row.student_name || 'Unnamed')
    const currentTotal = round2(Number(row.total_fee) || 0)
    const paid = round2(Number(row.amount_paid) || 0)

    /*
     * A record that does not say how the student attends cannot be priced:
     * in person and online cost different amounts, and guessing charges one
     * of them the other's fee. Reported, so it is visibly left out rather
     * than quietly missing from the count.
     */
    const mode = parseMode(row.delivery)
    if (!mode) {
      skipped.push({ id: row.id, student, why: 'No class mode recorded — in person or online is unknown' })
      continue
    }

    const target = round2(feeForMode(mode))
    if (target === currentTotal) {
      skipped.push({ id: row.id, student, why: 'Already on the current fee' })
      continue
    }

    const next = repriceTo(target, paid)
    changes.push({
      id: row.id, student,
      from: currentTotal, to: next.totalFee,
      amountPaid: next.amountPaid, balance: next.balance,
      status: next.status, inCredit: next.balance < 0,
    })

    // Only the rows that actually change count toward the comparison, so the
    // figure shown is the effect of pressing the button.
    owedBefore += Math.max(0, round2(currentTotal - paid))
    owedAfter += Math.max(0, next.balance)
  }

  return {
    changes,
    skipped,
    owedBefore: round2(owedBefore),
    owedAfter: round2(owedAfter),
    creditCount: changes.filter(c => c.inCredit).length,
  }
}

/**
 * A plan is only safe to apply if it is the plan that was shown.
 *
 * Between previewing and confirming, somebody may have registered, paid or
 * been corrected. Applying a stale plan would re-price people the operator
 * never saw. The count and the exact set of ids both have to match.
 */
export function planMatches(plan: BulkPlan, confirmedIds: string[]): boolean {
  const planned = plan.changes.map(c => c.id).sort()
  const confirmed = [...new Set(confirmedIds)].sort()
  if (planned.length !== confirmed.length) return false
  return planned.every((id, i) => id === confirmed[i])
}
