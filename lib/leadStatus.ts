// Shared client helper — every page changes lead status through here,
// so registration always credits remuneration points the same way.

export interface StatusChangeResult {
  success?: boolean
  credited?: boolean
  needsProgram?: boolean
  programs?: { code: string; name: string; points: number; is_corporate: boolean }[]
  message?: string
  error?: string
}

export async function changeLeadStatus(
  leadId: string,
  status: string,
  opts: { programCode?: string; delivery?: string; corporateValue?: number; marketerId?: string } = {},
): Promise<StatusChangeResult> {
  const res = await fetch('/api/leads/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, status, ...opts }),
  })
  return res.json()
}
