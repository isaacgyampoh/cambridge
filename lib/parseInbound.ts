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
  /** The Linked ID digits, if the provider sent one. Leads created before the
   *  real number was available may be stored under this, so it is kept for
   *  matching — never for display. */
  lid: string | null
  text: string | null
  fromMe: boolean
  mediaType: string | null
  senderName: string | null
  eventName: string | null
}

// The provider's own guidance: remoteJid is often a Linked ID (…@lid), NOT a
// phone number. The cleaned fields carry the real number, so they win.
const PHONE_PRIMARY = /^(cleanedsenderpn|cleanedparticipantpn|senderpn|participantpn)$/i
const PHONE_FALLBACK = /^(remotejid|jid|chatid|from|sender|author|participant|phone|number|wa_id|waid|msisdn|recipient)$/i
// messageBody is the provider's unified text field and should win over
// digging through conversation / extendedTextMessage.
const TEXT_PRIMARY = /^(messagebody)$/i
const TEXT_KEYS = /^(conversation|text|body|caption|message|content|extendedtext)$/i
const NAME_KEYS = /^(pushname|notifyname|sendername|name|contactname)$/i
const MEDIA_KEYS = /(audiomessage|voicemessage|pttmessage|imagemessage|videomessage|documentmessage|stickermessage)$/i

/** A WhatsApp id or phone number, normalised to digits. */
function asPhone(v: any, allowLid = false): string | null {
  if (typeof v !== 'string') return null
  // A Linked ID is an internal identifier, not a number anyone can be reached
  // on. Treating one as a phone means matching no lead and replying to nobody.
  if (!allowLid && /@lid$/i.test(v)) return null
  // Group ids are never a person.
  if (/@g\.us$/i.test(v)) return null
  const head = v.split('@')[0].split(':')[0]
  const digits = head.replace(/[^0-9]/g, '')
  if (digits.length < 9 || digits.length > 15) return null
  return digits
}

export function parseInbound(body: any): Inbound {
  const out: Inbound = { phone: null, lid: null, text: null, fromMe: false, mediaType: null, senderName: null, eventName: null }
  if (!body || typeof body !== 'object') return out

  out.eventName = typeof body.event === 'string' ? body.event
    : typeof body.type === 'string' ? body.type : null

  const seen = new Set<any>()
  let bestText: string | null = null
  let bestPhone: string | null = null
  let primaryPhone: string | null = null
  let primaryText: string | null = null

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

      // who sent it — the cleaned number always wins over an id
      if (!primaryPhone && PHONE_PRIMARY.test(key)) {
        const p = asPhone(val, true)
        if (p) primaryPhone = p
      }
      if (!bestPhone && PHONE_FALLBACK.test(key)) {
        const p = asPhone(val)
        if (p) bestPhone = p
      }
      // Keep the LID for matching leads created before the real number existed
      if (!out.lid && typeof val === 'string' && /@lid$/i.test(val)) {
        const digits = val.split('@')[0].replace(/[^0-9]/g, '')
        if (digits) out.lid = digits
      }

      // their name
      if (!out.senderName && NAME_KEYS.test(key) && typeof val === 'string' && val.trim() && val.length < 60) {
        out.senderName = val.trim()
      }

      // media
      if (!out.mediaType && MEDIA_KEYS.test(key)) out.mediaType = key

      // what they said — the unified body wins over the raw variants
      if (!primaryText && TEXT_PRIMARY.test(key) && typeof val === 'string' && val.trim()) {
        primaryText = val.trim()
      }
      if (!bestText && TEXT_KEYS.test(key) && typeof val === 'string' && val.trim()) {
        bestText = val.trim()
      }

      if (val && typeof val === 'object') walk(val, depth + 1)
    }
  }

  walk(body, 0)
  out.phone = primaryPhone || bestPhone
  out.text = primaryText || bestText
  return out
}
