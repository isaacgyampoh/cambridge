import { SECRETS } from '@/lib/config.server'

/**
 * One AI client for the whole system. Both the WhatsApp assistant and the
 * Content Studio call this, so the provider (OpenAI or Anthropic) is
 * configured in exactly one place. Switch providers in lib/config.ts.
 */

export type AIMessage = { role: 'user' | 'assistant'; content: string }

export function aiConfigured(): boolean {
  return SECRETS.aiProvider === 'openai' ? !!SECRETS.openaiApiKey : !!SECRETS.anthropicApiKey
}

/**
 * Send a chat completion. Returns the assistant's text, or null on failure
 * / when no key is set. Never throws — callers fall back gracefully.
 */
export async function aiComplete(opts: {
  system: string
  messages: AIMessage[]
  maxTokens?: number
  temperature?: number
}): Promise<string | null> {
  const { system, messages, maxTokens = 1000, temperature } = opts
  try {
    if (SECRETS.aiProvider === 'openai') {
      if (!SECRETS.openaiApiKey) return null
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SECRETS.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: SECRETS.openaiModel || 'gpt-4o',
          max_tokens: maxTokens,
          ...(temperature != null ? { temperature } : {}),
          messages: [{ role: 'system', content: system }, ...messages],
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) { console.error('[ai-client] openai', res.status, await res.text().catch(() => '')); return null }
      const data = await res.json()
      return data?.choices?.[0]?.message?.content?.trim() || null
    }

    // Anthropic
    if (!SECRETS.anthropicApiKey) return null
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': SECRETS.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: SECRETS.aiModel,
        max_tokens: maxTokens,
        ...(temperature != null ? { temperature } : {}),
        system,
        messages,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) { console.error('[ai-client] anthropic', res.status); return null }
    const data = await res.json()
    const blocks = (data?.content || []) as Array<{ type?: string; text?: string }>
    return blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim() || null
  } catch (e: unknown) {
    console.error('[ai-client] error', (e instanceof Error ? e.message : String(e)))
    return null
  }
}
