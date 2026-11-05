import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { campaignProgress } from '@/lib/infoSessionCampaign'

export const runtime = 'nodejs'

/**
 * Where a campaign has got to, for the screen to poll while it runs.
 *
 * Counted from the recipient ledger, so "sent" is the number of people a
 * channel actually accepted — not a figure the first hop guessed and wrote
 * down.
 */
export const GET = withGuard({ portals: ['grp_automation'] }, async (req: NextRequest) => {
  const id = new URL(req.url).searchParams.get('session')
  if (!id) return NextResponse.json({ error: 'Which session?' }, { status: 400 })

  const progress = await campaignProgress(id)
  if ('error' in progress) return NextResponse.json(progress, { status: 503 })
  return NextResponse.json({ success: true, ...progress })
})
