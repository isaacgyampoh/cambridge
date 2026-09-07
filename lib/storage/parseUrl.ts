/**
 * The bucket and path inside a Supabase Storage URL.
 *
 * Pure and dependency-free so it can be tested directly: no next/server, no
 * database, no network. The delete route is a thin wrapper around it, and the
 * rules that make deletion safe live here where they can be exercised.
 *
 * ── WHY A URL AND NOT A BUCKET + PATH ──────────────────────────────────────
 *
 * The caller already holds the file's URL — it is what the record stores. If
 * the endpoint took a bucket and a path instead, every caller would have to
 * take them apart itself and any caller could aim it anywhere by constructing
 * a pair. Taking the URL means the only files that can be named are files the
 * system wrote.
 */

/** The buckets this product writes to. Nothing else may be deleted. */
const BUCKETS = new Set(['uploads', 'materials'])

export type StorageTarget = { bucket: string; path: string }

export function parseStorageUrl(raw: string): StorageTarget | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  /*
   * Supabase serves the same object under three shapes:
   *
   *   /storage/v1/object/public/<bucket>/<path>   public bucket
   *   /storage/v1/object/sign/<bucket>/<path>     signed link
   *   /storage/v1/object/<bucket>/<path>          authenticated
   *
   * A record may hold any of them depending on which bucket it went to, so
   * all three are accepted and anything else is refused.
   */
  const m = url.pathname.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?([^/]+)\/(.+)$/)
  if (!m) return null

  const bucket = decodeURIComponent(m[1])
  const path = decodeURIComponent(m[2])

  if (!BUCKETS.has(bucket)) return null

  // No traversal, no absolute path, no empty segment. Decoding happens BEFORE
  // this check, so an encoded `..` is caught rather than passed through.
  if (!path || path.startsWith('/')) return null
  if (path.split('/').some(seg => seg === '..' || seg === '')) return null

  return { bucket, path }
}
