/**
 * Upload a file to Supabase Storage via the server endpoint (replaces
 * Cloudinary). Returns { url, name, size, type } or throws.
 */
export async function uploadFile(file: File, folder = 'misc'): Promise<{ url: string; name: string; size: number; type: string; path: string }> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('folder', folder)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  const d = await res.json().catch(() => ({ error: 'Upload failed' }))
  if (!res.ok || d.error) throw new Error(d.error || 'Upload failed')
  return d
}
