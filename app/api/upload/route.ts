import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireSession, GuardError } from '@/lib/auth/guard'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * The single upload endpoint for the app.
 *
 * Previously this was listed as a PUBLIC path: no session, no file-type check,
 * and both the stored extension and the stored Content-Type were taken
 * straight from the uploaded file. Anyone on the internet could put an HTML or
 * SVG file into the public bucket and be handed back a URL on the project's
 * own Supabase domain that served their JavaScript — stored cross-site
 * scripting, plus free file hosting under the institution's name.
 *
 * Now: a session is required for every folder except the three genuine public
 * submission folders below; the type is checked against an allowlist by
 * extension AND by magic bytes; and the Content-Type written to storage is the
 * one WE decide, never the one the caller supplied.
 */

const MAX_BYTES = 25 * 1024 * 1024        // signed-in staff
const PUBLIC_MAX_BYTES = 10 * 1024 * 1024 // anonymous submissions

/**
 * Folders that genuinely accept uploads from people who are not signed in:
 * an applicant attaching proof of payment, a student uploading a bank slip at
 * class sign-in, an alumnus sending a photo with a testimonial. These are the
 * only three, they take images and PDFs only, and they are rate limited by IP.
 * Every other folder requires a session.
 */
const PUBLIC_FOLDERS = new Set(['fee-proofs', 'bank-proofs', 'testimonials'])
const PUBLIC_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf'])

/** Extension → the Content-Type we will store it as. */
const ALLOWED: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
}

/**
 * Confirm the bytes really are what the extension claims.
 *
 * Checking only the filename lets someone rename evil.html to evil.png; the
 * signature check is what makes the extension allowlist mean anything.
 * Formats without a reliable magic number (CSV, plain Office binaries) are
 * accepted on extension alone — they are inert in a browser once the stored
 * Content-Type is fixed, which it now is.
 */
function signatureMatches(ext: string, buf: Buffer): boolean {
  const startsWith = (...bytes: number[]) =>
    bytes.every((b, i) => buf[i] === b)
  const atOffset = (offset: number, ascii: string) =>
    buf.subarray(offset, offset + ascii.length).toString('ascii') === ascii

  switch (ext) {
    case 'jpg': case 'jpeg': return startsWith(0xff, 0xd8, 0xff)
    case 'png':  return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case 'gif':  return atOffset(0, 'GIF87a') || atOffset(0, 'GIF89a')
    case 'webp': return atOffset(0, 'RIFF') && atOffset(8, 'WEBP')
    case 'pdf':  return atOffset(0, '%PDF-')
    // OOXML files are ZIP archives.
    case 'docx': case 'xlsx': case 'pptx': return startsWith(0x50, 0x4b)
    case 'mp4':  return atOffset(4, 'ftyp')
    case 'mp3':  return startsWith(0x49, 0x44, 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
    default:     return true
  }
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'That upload was not readable.' }, { status: 400 })
  }

  const folder = (form.get('folder') as string | null)?.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'misc'
  const isPublicFolder = PUBLIC_FOLDERS.has(folder)

  // A session is required for everything except the three public submission
  // folders, whose limits are tighter.
  let actorId: string | null = null
  if (!isPublicFolder) {
    try {
      const ctx = await requireSession(req)
      actorId = ctx.session.userId
    } catch (e) {
      return (e as GuardError).response
    }
  }

  const limitKey = actorId ? `upload:user:${actorId}` : `upload:ip:${clientIp(req)}`
  const limit = actorId
    ? await rateLimit(limitKey, 60, 10 * 60, 10 * 60)
    : await rateLimit(limitKey, 10, 10 * 60, 30 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many uploads from here just now. ${retryMessage(limit.retryAfter)}` },
      { status: 429 }
    )
  }

  try {
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was provided.' }, { status: 400 })
    }

    const maxBytes = isPublicFolder ? PUBLIC_MAX_BYTES : MAX_BYTES
    if (file.size === 0) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
    if (file.size > maxBytes) {
      return NextResponse.json({
        error: `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${Math.round(maxBytes / 1048576)} MB — please compress it and try again.`,
      }, { status: 413 })
    }

    const ext = (file.name?.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const contentType = ALLOWED[ext]
    if (!contentType || (isPublicFolder && !PUBLIC_EXTENSIONS.has(ext))) {
      const permitted = isPublicFolder ? [...PUBLIC_EXTENSIONS] : Object.keys(ALLOWED)
      return NextResponse.json({
        error: `Files of type .${ext || '(unknown)'} cannot be uploaded here. Allowed: ${permitted.join(', ')}.`,
      }, { status: 415 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (!signatureMatches(ext, bytes)) {
      return NextResponse.json({
        error: `That file does not look like a real .${ext} file. Please check it and try again.`,
      }, { status: 415 })
    }

    // Folder and filename are both reduced to a safe character set, and the
    // stored name is generated rather than taken from the upload, so a crafted
    // filename cannot traverse paths or collide deliberately.
    const isMaterial = /material/i.test(folder)
    const bucket = isMaterial ? 'materials' : 'uploads'
    const safeBase = (file.name?.replace(/\.[^.]+$/, '') || 'file')
      .replace(/[^a-z0-9_-]/gi, '-').slice(0, 40)
    const path = `${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeBase}.${ext}`

    const sb = createServiceClient()

    if (isMaterial) {
      try {
        const { data: buckets } = await sb.storage.listBuckets()
        if (!(buckets || []).some(b => b.name === 'materials')) {
          await sb.storage.createBucket('materials', { public: false, fileSizeLimit: MAX_BYTES })
        }
      } catch { /* handled by the upload error path below */ }
    }

    const { error } = await sb.storage.from(bucket).upload(path, bytes, {
      contentType,          // ours, never the caller's
      upsert: false,
    })

    if (error) {
      // The raw storage message is logged for us, not returned to the browser.
      console.error('[upload] storage rejected the file:', error.message)
      const m = String(error.message || '')
      const friendly =
        /bucket.*not found|does not exist/i.test(m) ? 'File storage is not set up yet. Please contact your administrator.'
        : /exceeded.*size|payload too large/i.test(m) ? 'That file is larger than the 25 MB limit.'
        : /duplicate|already exists/i.test(m) ? 'A file with that name was just uploaded. Please try again.'
        : 'The upload did not complete. Please try again.'
      return NextResponse.json({ error: friendly }, { status: 500 })
    }

    const url = isMaterial
      ? `materials://${path}`
      : sb.storage.from(bucket).getPublicUrl(path).data.publicUrl

    return NextResponse.json({
      success: true, url, path, bucket,
      secured: isMaterial,
      name: file.name, size: bytes.length, type: contentType,
    })
  } catch (e) {
    console.error('[upload] failed:', e)
    return NextResponse.json({ error: 'The upload did not complete. Please try again.' }, { status: 500 })
  }
}
