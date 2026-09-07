import { NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { parseStorageUrl } from '@/lib/storage/parseUrl'

export const runtime = 'nodejs'

/**
 * Remove an uploaded file from storage.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * There was an upload endpoint and nothing else, so nothing in the product
 * had ever deleted a file. The document library's delete removed the database
 * row and left the file where it was — while telling the operator
 *
 *   "Anyone holding a link to it will no longer be able to open it."
 *
 * which was not true. The row went; the file stayed at its public storage URL
 * and anyone who had that URL kept it. For an admission letter or a signed
 * form that is a disclosure, not untidiness.
 *
 * ── WHAT IT WILL AND WILL NOT DELETE ───────────────────────────────────────
 *
 * Only the two buckets this product writes to, and only a path parsed out of
 * a storage URL that actually belongs to one of them. It takes a URL rather
 * than a bucket and path so a caller cannot aim it at something by
 * constructing one. The rules live in lib/storage/parseUrl, which is pure and
 * under test — traversal, foreign buckets and non-storage URLs are all
 * refused there.
 */

const ROLES = ['super_admin', 'administrator', 'project_manager', 'content_manager']

export const POST = withGuard({ roles: ROLES }, async (req, { session }) => {
  const { url } = await req.json().catch(() => ({ url: null }))

  if (typeof url !== 'string' || !url) {
    return NextResponse.json({ error: 'No file was named.' }, { status: 400 })
  }

  const target = parseStorageUrl(url)
  if (!target) {
    return NextResponse.json(
      { error: 'That does not look like a file this system stores.' },
      { status: 400 },
    )
  }

  const sb = createServiceClient()
  const { error } = await sb.storage.from(target.bucket).remove([target.path])

  if (error) {
    /*
     * Reported, not swallowed. The caller has usually just deleted the
     * database row, so a silent failure here is exactly how the orphan is
     * created — the record is gone and nobody knows the file is still there.
     */
    console.error('[upload/delete] could not remove', target.bucket, target.path, error.message)
    return NextResponse.json(
      { error: 'The record was removed but the file could not be deleted. Raise this with support.' },
      { status: 502 },
    )
  }

  await recordAudit({
    actorId: session.userId,
    action: 'storage.file_deleted',
    resource: target.bucket,
    resourceId: target.path,
    success: true,
    metadata: { bucket: target.bucket, path: target.path },
  })

  return NextResponse.json({ success: true })
})
