'use client'

import Overview from '@/components/dashboard/Overview'

/**
 * The administrator's home.
 *
 * The dashboard itself is shared — see components/dashboard/Overview. What an
 * administrator sees that a marketer does not is decided by the server, which
 * knows their portals, rather than by rendering a different screen.
 */
export default function AdminHome() {
  return <Overview />
}
