import { aiComplete } from '@/lib/integrations/ai-client'

type ContentTask = 'write' | 'critique' | 'improve' | 'hashtags' | 'ideas' | 'image_brief'

const SYSTEM = `You are a senior social media strategist for Cambridge Centre of Excellence, a professional training institute in Ghana offering PMP, HR (PHRi/SPHRi), and other career certifications.

Your audience: ambitious working professionals and graduates in Ghana looking to advance their careers. Tone: confident, aspirational, credible, clear. Avoid hype and clichés. Use Ghanaian context where natural (GHS pricing, local relevance).

Best practices you follow:
- Lead with the benefit or a hook, not the course name.
- One clear call-to-action.
- Short, scannable lines for social.
- Anchor value (career growth, salary, global credential) before price.
- Platform-aware: LinkedIn = professional/longer; Instagram/Facebook = punchy + visual; WhatsApp = warm + direct; TikTok = hook in first line.
Never invent facts (dates, prices) unless given them.`

function buildPrompt(task: ContentTask, input: string, platform?: string, context?: string): string {
  const plat = platform ? ` for ${platform}` : ''
  switch (task) {
    case 'write':
      return `Write a social media post${plat} based on this brief:\n\n${input}\n\n${context ? `Context/facts to use:\n${context}\n\n` : ''}Give the post text only, ready to publish. Include a strong hook and one clear CTA.`
    case 'critique':
      return `Critique this draft${plat} as an expert strategist. Point out what works, what's weak, and exactly how to improve it (hook, clarity, CTA, length, value framing). Be specific and constructive.\n\nDraft:\n${input}`
    case 'improve':
      return `Rewrite and improve this post${plat} using best practices. Keep the core message but make it stronger — better hook, clearer CTA, tighter copy.\n\nOriginal:\n${input}`
    case 'hashtags':
      return `Suggest 8-12 relevant, effective hashtags${plat} for this post. Mix broad and niche, Ghana-relevant where useful. Return just the hashtags.\n\nPost:\n${input}`
    case 'ideas':
      return `Generate 6 strong content ideas${plat} for this topic/goal. For each: a one-line hook and a sentence on the angle.\n\nTopic:\n${input}`
    case 'image_brief':
      return `Describe the ideal visual/graphic to accompany this post${plat}. Give a clear creative brief a designer could follow: composition, key text overlay, colours, mood, and what to show. Keep it practical for a training institute in Ghana.\n\nPost:\n${input}`
  }
}

export async function generateContent(task: ContentTask, input: string, platform?: string, context?: string, brand?: string): Promise<string | null> {
  const system = brand ? `${SYSTEM}\n\nBRAND GUIDELINES (follow these closely):\n${brand}` : SYSTEM
  return aiComplete({
    system,
    messages: [{ role: 'user', content: buildPrompt(task, input, platform, context) }],
    maxTokens: 1000,
  })
}
