import LeadDistribution from '@/components/leads/LeadDistribution'

/**
 * Settings -> Lead distribution, for the super admin.
 *
 * Sits under /admin/settings so it inherits the `settings` portal from
 * PORTAL_PATHS rather than needing a route rule of its own. The project
 * manager reaches the same screen at /pm/lead-distribution; the API decides
 * what each of them may do.
 */
export default function Page() {
  return <LeadDistribution />
}
