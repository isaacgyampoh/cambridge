/**
 * Find the sender, message and direction in a WhatsApp webhook — whatever
 * shape the provider uses.
 *
 * Providers nest these differently and change formats without notice, so
 * rather than matching known paths, this walks the whole payload looking for
 * the things that identify a message. It works with any structure.
 */
export interface Inbound {
  phone: string | null
  text: string | null
  fromMe: boolean
  mediaType: string | null
  senderName: string | null
  eventName: string | null
}

const PHONE_KEYS = /^(remotejid|jid|chatid|from|sender|author|participant|phone|number|wa_id|waid|msisdn|recipient)$/i
const TEXT_KEYS = /^(conversation|text|body|caption|message|content|extendedtext)$/i
const NAME_KEYS = /^(pushname|notifyname|sendername|name|contactname)$/i
const MEDIA_KEYS = /(audiomessage|voicemessage|pttmessage|imagemessage|videomessage|documentmessage|stickermessage)$/i

/** A WhatsApp id or phone number, normalised to digits. */
function asPhone(v: any): string | null {
  if (typeof v !== 'string') return null
  const head = v.split('@')[0].split(':')[0]
  const digits = head.replace(/[^0-9]/g, '')
  // Real numbers are 9–15 digits. Anything else is an id, not a phone.
  if (digits.length < 9 || digits.length > 15) return null
  // Group ids are long and end in @g.us — never treat those as a person.
  if (/@g\.us$/i.test(v)) return null
  return digits
}

export function parseInbound(body: any): Inbound {
  const out: Inbound = { phone: null, text: null, fromMe: false, mediaType: null, senderName: null, eventName: null }
  if (!body || typeof body !== 'object') return out

  out.eventName = typeof body.event === 'string' ? body.event
    : typeof body.type === 'string' ? body.type : null

  const seen = new Set<any>()
  let bestText: string | null = null
  let bestPhone: string | null = null

  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }

    for (const [rawKey, val] of Object.entries(node)) {
      const key = rawKey.toLowerCase()

      // direction
      if (key === 'fromme' || key === 'from_me' || key === 'isfromme') {
        if (val === true || val === 'true' || val === 1 || val === '1') out.fromMe = true
      }

      // who sent it
      if (!bestPhone && PHONE_KEYS.test(key)) {
        const p = asPhone(val)
        if (p) bestPhone = p
      }

      // their name
      if (!out.senderName && NAME_KEYS.test(key) && typeof val === 'string' && val.trim() && val.length < 60) {
        out.senderName = val.trim()
      }

      // media
      if (!out.mediaType && MEDIA_KEYS.test(key)) out.mediaType = key

      // what they said — prefer a plain string on a text-like key
      if (!bestText && TEXT_KEYS.test(key) && typeof val === 'string' && val.trim()) {
        bestText = val.trim()
      }

      if (val && typeof val === 'object') walk(val, depth + 1)
    }
  }

  walk(body, 0)
  out.phone = bestPhone
  out.text = bestText
  return out
}
