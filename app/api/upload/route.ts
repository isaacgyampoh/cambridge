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

    const bytes = Buffer.from(await file.arrayBuffer())
    const ext = (file.name?.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
    const safeBase = (file.name?.replace(/\.[^.]+$/, '') || 'file').replace(/[^a-z0-9_-]/gi, '-').slice(0, 40)
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}.${ext}`

    const sb = createServiceClient()
    const { error } = await sb.storage.from(bucket).upload(path, bytes, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // A private file has no public address; the portal streams it instead.
    const url = isMaterial
      ? `materials://${path}`
      : sb.storage.from(bucket).getPublicUrl(path).data.publicUrl

    return NextResponse.json({
      success: true, url, path, bucket,
      name: file.name, size: bytes.length, type: file.type,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
