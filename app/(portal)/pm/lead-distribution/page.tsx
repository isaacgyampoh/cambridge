import LeadDistribution from '@/components/leads/LeadDistribution'

/**
 * Lead distribution, for the project manager.
 *
 * Under /pm, so it inherits the `pm_leads` portal. The same screen the super
 * admin sees under Settings — not a reduced copy, because the PM is allowed
 * the same actions here and a second implementation would drift.
 */
export default function Page() {
  return <LeadDistribution />
}
