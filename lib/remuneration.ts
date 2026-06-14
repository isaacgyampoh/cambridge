import { createServiceClient } from '@/lib/supabase/server'

export interface RankBand {
  name: string
  min_points: number
  max_points: number | null
  gross_salary: number
  sort_order: number
}

export interface MarketerRemuneration {
  marketerId: string
  year: number
  totalPoints: number
  enrollmentCount: number
  registrationCommission: number   // GHS 200 x students (theirs)
  currentRank: RankBand | null
  nextRank: RankBand | null
  pointsToNext: number
  progressPct: number              // progress through current band toward next
  grossSalary: number
  byProgram: { code: string; name: string; count: number; points: number }[]
  byDelivery: { in_person: number; online: number }
}

/** Resolve which rank band a points total falls into. */
export function resolveRank(points: number, bands: RankBand[]): RankBand | null {
  const sorted = [...bands].sort((a, b) => a.min_points - b.min_points)
  let current: RankBand | null = null
  for (const b of sorted) {
    if (points >= b.min_points && (b.max_points == null || points <= b.max_points)) {
      current = b
    }
  }
  // if above everything, take the highest; if below the first, no rank yet
  if (!current && points >= (sorted[sorted.length - 1]?.min_points ?? Infinity)) {
    current = sorted[sorted.length - 1]
  }
  return current
}

export function nextRank(current: RankBand | null, bands: RankBand[]): RankBand | null {
  const sorted = [...bands].sort((a, b) => a.min_points - b.min_points)
  if (!current) return sorted[0] || null
  const idx = sorted.findIndex(b => b.name === current.name)
  return sorted[idx + 1] || null
}

/**
 * Compute a marketer's full remuneration picture for a given year.
 */
export async function computeRemuneration(marketerId: string, year?: number): Promise<MarketerRemuneration> {
  const yr = year || new Date().getFullYear()
  const sb = createServiceClient()

  const [enrollR, bandsR] = await Promise.all([
    sb.from('marketer_enrollments').select('*').eq('marketer_id', marketerId).eq('year', yr),
    sb.from('rank_bands').select('*').order('sort_order', { ascending: true }),
  ])

  const enrollments = enrollR.data || []
  const bands = (bandsR.data || []) as RankBand[]

  const totalPoints = enrollments.reduce((a: number, e: any) => a + Number(e.points || 0), 0)
  const registrationCommission = enrollments.reduce((a: number, e: any) => a + Number(e.registration_fee || 0), 0)

  const currentRank = resolveRank(totalPoints, bands)
  const next = nextRank(currentRank, bands)
  const pointsToNext = next ? Math.max(0, next.min_points - totalPoints) : 0

  // progress through the current band toward the next threshold
  let progressPct = 0
  if (currentRank) {
    const floor = currentRank.min_points
    const ceil = next ? next.min_points : (currentRank.max_points || currentRank.min_points)
    progressPct = ceil > floor ? Math.min(100, Math.round(((totalPoints - floor) / (ceil - floor)) * 100)) : 100
  } else if (next) {
    // below the first band — progress toward Alpha
    progressPct = Math.min(100, Math.round((totalPoints / next.min_points) * 100))
  }

  // by program
  const progMap: Record<string, { code: string; name: string; count: number; points: number }> = {}
  enrollments.forEach((e: any) => {
    const k = e.program_code
    if (!progMap[k]) progMap[k] = { code: k, name: e.program_name || k, count: 0, points: 0 }
    progMap[k].count++
    progMap[k].points += Number(e.points || 0)
  })

  const byDelivery = {
    in_person: enrollments.filter((e: any) => e.delivery === 'in_person').length,
    online: enrollments.filter((e: any) => e.delivery === 'online').length,
  }

  return {
    marketerId,
    year: yr,
    totalPoints,
    enrollmentCount: enrollments.length,
    registrationCommission,
    currentRank,
    nextRank: next,
    pointsToNext,
    progressPct,
    grossSalary: currentRank?.gross_salary || 0,
    byProgram: Object.values(progMap).sort((a, b) => b.points - a.points),
    byDelivery,
  }
}
