/**
 * Who owns a lead somebody typed in by hand.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * A member of staff who goes out and finds somebody keeps that lead. That is
 * true of a marketer, an accountant, an exams prep coordinator, a
 * receptionist and anyone else doing the job — it is their lead, and the
 * system should not take it off them and raffle it.
 *
 * Two roles are different, because they enter leads ON BEHALF OF the centre
 * rather than for themselves: the super admin and the project manager. What
 * they type in belongs to the company and goes to distribution. They can
 * still keep one deliberately — see `keepForSelf` — but it is a choice they
 * make, not the default.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * Ownership was decided by whether the caller held the `leads` or `pm_leads`
 * PORTAL, and anybody holding one was treated as a distributor whose lead
 * went to the weighted lottery unless they named somebody.
 *
 * An accountant holds `leads`. So does an admissions officer. So does anyone
 * granted extra access individually — which is how an exams prep coordinator
 * ended up reporting that the leads they entered came out unassigned. Five
 * roles were losing their own leads to the pool, and a portal grant made for
 * a quite different reason silently changed who owned somebody's work.
 *
 * A portal says what somebody may SEE. It should never have decided what they
 * OWN. The rule is about the role, and it is stated here rather than inferred.
 */

/** Entering a lead for the centre, not for themselves. */
export const COMPANY_LEAD_ROLES = ['super_admin', 'administrator', 'project_manager'] as const

/** Holding one of these means a person may name somebody else as the owner. */
export const DISTRIBUTOR_PORTALS = ['leads', 'pm_leads'] as const

export type OwnershipDecision = {
  /** The owner to write. `null` means the company pool: distribution decides. */
  owner: string | null
  /** Why, in words, for the activity line and for anyone reading this later. */
  because: string
  /** True when the caller was allowed to name somebody other than themselves. */
  mayDelegate: boolean
}

export function entersLeadsForTheCompany(role: string | null | undefined): boolean {
  return (COMPANY_LEAD_ROLES as readonly string[]).includes(String(role ?? ''))
}

export function mayNameAnotherOwner(
  role: string | null | undefined,
  portals: readonly string[] = [],
): boolean {
  if (entersLeadsForTheCompany(role)) return true
  return portals.some(p => (DISTRIBUTOR_PORTALS as readonly string[]).includes(p))
}

/**
 * Decide the owner. The caller influences this only where it is their job to.
 *
 * `requestedOwner` is honoured for somebody who may delegate, and ignored
 * entirely for everybody else — a browser can send any id, and a marketer
 * naming a colleague as the owner of a lead is a commission dispute waiting
 * to happen.
 */
export function decideOwner(input: {
  actorId: string
  role: string | null | undefined
  portals?: readonly string[]
  /** A colleague named deliberately. */
  requestedOwner?: string | null
  /** A company-lead role choosing to keep this one themselves. */
  keepForSelf?: boolean
  /** Anyone who may delegate choosing to send this one to distribution. */
  toPool?: boolean
}): OwnershipDecision {
  const { actorId, role, portals = [], requestedOwner, keepForSelf, toPool } = input
  const mayDelegate = mayNameAnotherOwner(role, portals)

  if (!mayDelegate) {
    /*
     * Everyone else gets themselves, whatever the request said. This is the
     * line that was missing: an accountant or a coordinator typing in a lead
     * they found keeps it.
     */
    return { owner: actorId, because: 'Added by the person who will work it.', mayDelegate: false }
  }

  // A named colleague is the most explicit thing anybody can ask for.
  if (requestedOwner) {
    return {
      owner: requestedOwner,
      because: requestedOwner === actorId
        ? 'Added and kept by the person who entered it.'
        : 'Added on a colleague’s behalf.',
      mayDelegate: true,
    }
  }

  if (toPool) {
    return { owner: null, because: 'Added for the centre; distribution will place it.', mayDelegate: true }
  }

  if (entersLeadsForTheCompany(role)) {
    /*
     * The default for a super admin or a project manager. They enter leads
     * for the centre, so an unmarked one belongs to the centre — unless they
     * say otherwise.
     */
    if (keepForSelf) {
      return { owner: actorId, because: 'Added and kept by the person who entered it.', mayDelegate: true }
    }
    return { owner: null, because: 'Added for the centre; distribution will place it.', mayDelegate: true }
  }

  /*
   * Holds a distributor portal but is not a company-lead role — an
   * accountant, an admissions officer, or anyone granted the access
   * individually. They named nobody, so it is theirs. This is the case that
   * used to fall through to the lottery.
   */
  return { owner: actorId, because: 'Added by the person who will work it.', mayDelegate: true }
}
