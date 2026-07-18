import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { aiComplete, aiConfigured } from '@/lib/integrations/ai-client'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'content_manager', 'project_manager']

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  if (!aiConfigured()) return NextResponse.json({ error: 'AI is not configured.' }, { status: 400 })

  const { kind, input } = await req.json()

  const prompts: Record<string, string> = {
    weekly_plan: `Create a practical 7-day social media posting plan for Cambridge Center of Excellence, a professional training institute in Ghana offering PMP, Corporate Training, PHRi, SPHRi, Software Agile Project Management, and Results-Based M&E. For each day give: the platform (Facebook/Instagram/LinkedIn), the best time to post in Ghana time, the post type (reel/carousel/story/post), a concrete content idea, and the goal (awareness/leads/engagement). Be specific and realistic, not generic.`,
    best_times: `Give the best days and times to post on Facebook, Instagram, and LinkedIn to reach working professionals and recent graduates in Ghana who might want professional certifications. Explain briefly WHY each time works. Be specific with actual time ranges in GMT.`,
    shadow: `Here is a competitor's post/ad:\n\n${input}\n\nExplain: (1) what makes it work, (2) how Cambridge Center of Excellence can create a stronger version without copying, (3) the exact hook/caption we should use, and (4) the best time and format to post our version. Be concrete.`,
    content_ideas: `Give 10 specific, scroll-stopping social media content ideas for Cambridge Center of Excellence (PMP, HR certifications, Agile PM, M&E training in Ghana). For each: the hook, the format (reel/carousel/etc), and why it would get engagement or leads. Avoid generic 'motivational' fluff — make them concrete and locally relevant to Ghana.`,
  }

  const prompt = prompts[kind] || prompts.content_ideas

  try {
    const result = await aiComplete({
      system: 'You are a senior social media strategist for a Ghanaian professional training institute. You are specific, practical, and results-focused. You never give generic advice — every suggestion is concrete and actionable. Format clearly with short sections.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1200, temperature: 0.7,
    })
    return NextResponse.json({ result })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'AI failed' }, { status: 500 })
  }
}
