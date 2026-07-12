'use client'
import { uploadFile } from '@/lib/upload'
import { useState, useRef } from 'react'
import { CONFIG } from '@/lib/config'
import { Upload, X, FileText, Image as ImageIcon, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Direct-to-Cloudinary uploader. Pick a file -> uploads -> returns the URL
 * via onUploaded. Works for images and PDFs (certificates, receipts,
 * brochures, student photos). Uses an unsigned upload preset so no secret
 * is exposed in the browser.
 */
export default function FileUpload({
  onUploaded, label = 'Upload file', accept = 'image/*,application/pdf', folder = 'cce', value, compact = false,
}: {
  onUploaded: (url: string) => void
  label?: string
  accept?: string
  folder?: string
  value?: string
  compact?: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(value || '')
  const inputRef = useRef<HTMLInputElement>(null)

  const configured = !!CONFIG.cloudinaryCloudName && !!CONFIG.cloudinaryUploadPreset

  async function handleFile(file: File) {
    if (!configured) {
      toast.error('File storage not set up yet. Add Cloudinary keys in settings.')
      return
    }
    if (file.size > 10 * 1024 * 1024) { toast.error('File too large (max 10MB)'); return }

    setUploading(true)
    try {
      const { url } = await uploadFile(file, folder)
      setPreview(url)
      onUploaded(url)
      toast.success('Uploaded')
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const isImage = preview && !preview.toLowerCase().endsWith('.pdf') && !preview.includes('/raw/')

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" accept={accept} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--line)] text-sm text-[var(--ink-soft)] hover:border-[var(--accent)] transition disabled:opacity-50">
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? 'Uploading…' : label}
        </button>
        {preview && <Check size={15} className="text-emerald-500" />}
      </div>
    )
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

      {preview ? (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-[var(--line)] bg-[var(--line-soft)]">
          {isImage ? (
            <img src={preview} alt="" className="w-12 h-12 rounded-lg object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center"><FileText size={20} /></div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--ink)]">File uploaded</div>
            <a href={preview} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--accent)] truncate block">View file</a>
          </div>
          <button type="button" onClick={() => { setPreview(''); onUploaded('') }} className="p-1.5 text-[var(--ink-faint)] hover:text-red-500"><X size={16} /></button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-[var(--line)] hover:border-[var(--accent)] transition disabled:opacity-50">
          {uploading ? <Loader2 size={22} className="animate-spin text-[var(--accent)]" /> : <Upload size={22} className="text-[var(--ink-faint)]" />}
          <span className="text-sm text-[var(--ink-soft)]">{uploading ? 'Uploading…' : label}</span>
          <span className="text-[11px] text-[var(--ink-faint)]">Images or PDF, up to 10MB</span>
        </button>
      )}

      {!configured && (
        <p className="text-[11px] text-amber-600 mt-2">File storage isn't connected yet. Add your Cloudinary keys to enable uploads.</p>
      )}
    </div>
  )
}
