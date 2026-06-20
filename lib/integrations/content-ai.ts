import { CONFIG } from '@/lib/config'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

type ContentTask = 'write' | 'critique' | 'improve' | 'hashtags' | 'ideas'

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
  }
}

export async function generateContent(task: ContentTask, input: string, platform?: string, context?: string): Promise<string | null> {
  if (!CONFIG.anthropicApiKey) return null
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CONFIG.aiModel,
        max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(task, input, platform, context) }],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) { console.error('[content-ai]', res.status); return null }
    const data = await res.json()
    return (data?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim() || null
  } catch (e: any) {
    console.error('[content-ai] error', e.message)
    return null
  }
}
