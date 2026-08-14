import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Single upload endpoint for the whole app — replaces Cloudinary.
 * Accepts multipart/form-data with a `file` field, stores it in the public
 * Supabase 'uploads' bucket via the service role (bypasses RLS), and returns
 * a public URL. Optional `folder` groups files (flyers, messages, docs, etc.)
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    // Course materials go to a PRIVATE bucket so they cannot be opened
    // directly by anyone holding the address. Everything else stays public.
    const folder = (form.get('folder') as string | null)?.replace(/[^a-z0-9_-]/gi, '') || 'misc'
    const isMaterial = /material/i.test(folder)
    const bucket = isMaterial ? 'materials' : 'uploads'
    if (!file) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })

    // Say plainly what is wrong, rather than a bare failure.
    const MAX = 50 * 1024 * 1024
    if (file.size > MAX) {
      return NextResponse.json({
        error: `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 50 MB — please compress it and try again.`,
      }, { status: 413 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const ext = (file.name?.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
    const safeBase = (file.name?.replace(/\.[^.]+$/, '') || 'file').replace(/[^a-z0-9_-]/gi, '-').slice(0, 40)
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}.${ext}`

    const sb = createServiceClient()

    // Create the private bucket on first use, so uploading never fails just
    // because a setup step has not been run yet.
    if (isMaterial) {
      try {
        const { data: buckets } = await sb.storage.listBuckets()
        if (!(buckets || []).some((b: any) => b.name === 'materials')) {
          await sb.storage.createBucket('materials', { public: false, fileSizeLimit: 52428800 })
        }
      } catch { /* if this fails we fall back below */ }
    }

    let usedBucket = bucket
    let { error } = await sb.storage.from(usedBucket).upload(path, bytes, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

    // If the private bucket still is not available, do not lose the file —
    // put it in the normal bucket and say so, rather than failing outright.
    if (error && isMaterial) {
      usedBucket = 'uploads'
      const retry = await sb.storage.from(usedBucket).upload(path, bytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
      error = retry.error
    }

    if (error) {
      // Translate the storage error into something actionable.
      const m = String(error.message || '')
      const friendly =
        /bucket.*not found|does not exist/i.test(m) ? 'Storage is not set up yet. Run COMPLETE-SETUP.sql in Supabase, then try again.'
        : /exceeded.*size|payload too large/i.test(m) ? 'That file is larger than the 50 MB limit.'
        : /duplicate|already exists/i.test(m) ? 'A file with that name was just uploaded. Try again.'
        : /policy|permission|denied|row-level/i.test(m) ? 'Storage permissions are blocking this. Run COMPLETE-SETUP.sql in Supabase.'
        : m || 'The upload failed.'
      console.error('[upload] failed:', m)
      return NextResponse.json({ error: friendly, detail: m }, { status: 500 })
    }

    // A private file has no public address; the portal streams it instead.
    const url = (isMaterial && usedBucket === 'materials')
      ? `materials://${path}`
      : sb.storage.from(usedBucket).getPublicUrl(path).data.publicUrl

    return NextResponse.json({
      success: true, url, path, bucket: usedBucket,
      secured: usedBucket === 'materials',
      name: file.name, size: bytes.length, type: file.type,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
