'use client'
import { uploadFile } from '@/lib/upload'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useData, mutate, mutateDelete } from '@/hooks/useData'
import { toast } from 'sonner'
import { Upload, FileText, Download, Trash2, Send, X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { CONFIG } from '@/lib/config'
import Modal from '@/components/shared/Modal'

const DOC_TYPES = [
  { value: 'admission_letter', label: 'Admission Letter' },
  { value: 'course_material', label: 'Course Material' },
  { value: 'brochure', label: 'School Brochure' },
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'receipt', label: 'Receipt Template' },
  { value: 'application_form', label: 'Application Form' },
  { value: 'certificate', label: 'Certificate Template' },
  { value: 'other', label: 'Other Document' },
]

const TEMPLATE_FIELDS = ['{{full_name}}', '{{email}}', '{{phone}}', '{{course}}', '{{batch}}', '{{date}}', '{{admission_number}}', '{{amount}}']

export default function DocumentsPage() {
  const { data: docs, loading, refetch: load } = useData<any>({
    table: 'documents', orderBy: 'created_at', orderAsc: false, limit: 200,
  })
  const [uploading, setUploading] = useState(false)
  const [sendModal, setSendModal] = useState<any>(null)
  const [students, setStudents] = useState<any[]>([])
  const [selectedStudents, setSelectedStudents] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({ name: '', type: 'admission_letter', description: '', is_template: false, course_id: '', delivery_scope: '' })
  const [courses, setCourses] = useState<any[]>([])
  const sb = createClient()

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(s => setUserId(s?.userId || null)).catch(() => {})
    fetch('/api/courses/public').then(r => r.json()).then(d => setCourses(d.list || [])).catch(() => {})
  }, [])

  async function upload(file: File) {
    if (!form.name) { toast.error('Enter a document name first'); return }
    if (!CONFIG.cloudinaryCloudName || !CONFIG.cloudinaryUploadPreset) {
      toast.error('File storage not set up yet. Add Cloudinary keys in settings.'); return
    }
    setUploading(true)

    let publicUrl = ''
    try {
      const up = await uploadFile(file, 'documents')
      publicUrl = up.url
    } catch (e: any) { toast.error('Upload failed: ' + e.message); setUploading(false); return }

    try {
      await mutate('POST', 'documents', {
        name: form.name,
        type: form.type,
        description: form.description || null,
        file_url: publicUrl,
        file_name: file.name,
        file_size: file.size,
        is_template: form.is_template,
        template_fields: form.is_template ? TEMPLATE_FIELDS : null,
        course_id: form.course_id || null,
        delivery_scope: form.type === 'course_material' ? (form.delivery_scope || null) : null,
        uploaded_by: userId,
      })
      toast.success('Document uploaded!')
      setForm({ name: '', type: 'admission_letter', description: '', is_template: false, course_id: '', delivery_scope: '' })
      load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to save document')
    } finally {
      setUploading(false)
    }
  }

  async function deleteDoc(id: string, fileUrl: string) {
    if (!confirm('Delete this document?')) return
    try {
      await mutateDelete('documents', [{ col: 'id', val: id }])
      toast.success('Document deleted')
      load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete')
    }
  }

  async function openSendModal(doc: any) {
    setSendModal(doc)
    const params = new URLSearchParams({
      table: 'profiles', select: 'id, full_name, email, phone',
      filters: JSON.stringify([{ col: 'role', op: 'eq', val: 'student' }, { col: 'is_active', op: 'eq', val: true }]),
      orderBy: 'full_name', limit: '500',
    })
    const res = await fetch(`/api/data?${params}`)
    const json = await res.json()
    setStudents(json.data || [])
    setSelectedStudents([])
  }

  async function sendToStudents() {
    if (!selectedStudents.length) { toast.error('Select at least one student'); return }
    setSending(true)
    const res = await fetch('/api/documents/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: sendModal.id, studentIds: selectedStudents }),
    })
    const d = await res.json()
    d.success ? toast.success(`Document sent to ${d.sent} students!`) : toast.error('Failed to send')
    setSending(false)
    setSendModal(null)
  }

  const TYPE_COLORS: Record<string, string> = {
    admission_letter: 'bg-[var(--accent-soft)] text-[var(--accent)]',
    brochure: 'bg-[var(--gold-soft)] text-[var(--gold)]',
    offer_letter: 'bg-[var(--ok-soft)] text-[var(--ok)]',
    receipt: 'bg-[var(--warn-soft)] text-[var(--warn)]',
    application_form: 'bg-[var(--warn-soft)] text-[var(--warn)]',
    certificate: 'bg-[var(--danger-soft)] text-[var(--danger)]',
    other: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
  }

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Document Library</h1>
          <p className="text-[var(--ink-faint)] text-sm mt-0.5">Manage PDF templates and official documents</p>
        </div>
      </div>

      {/* Upload section */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5 mb-6">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Upload New Document</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Document name (e.g. Admission Letter 2025)"
            className="h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            className="h-11 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)]">
            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Description (optional)"
            className="h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
          <label className="flex items-center gap-3 px-4 h-11 rounded-xl border border-[var(--line)] cursor-pointer hover:bg-[var(--line-soft)]">
            <input type="checkbox" checked={form.is_template} onChange={e => setForm(f => ({ ...f, is_template: e.target.checked }))}
              className="w-4 h-4 accent-blue-600" />
            <div>
              <div className="text-sm font-medium text-[var(--ink)]">Personalizable template</div>
              <div className="text-xs text-[var(--ink-faint)]">Can be auto-filled with student data</div>
            </div>
          </label>
        </div>

        {/* Programme selector — for admission letters & course materials so the
            right file is sent based on what the student registered for. */}
        {(form.type === 'admission_letter' || form.type === 'course_material') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">For which programme?</label>
              <select value={form.course_id} onChange={e => setForm(f => ({ ...f, course_id: e.target.value }))}
                className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)]">
                <option value="">All programmes (general)</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="text-[12px] text-[var(--ink-faint)] mt-1">e.g. upload one for PMP, another for SPHRi — the matching one is sent automatically.</p>
            </div>
            {form.type === 'course_material' && (
              <div>
                <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">Who receives it?</label>
                <select value={form.delivery_scope} onChange={e => setForm(f => ({ ...f, delivery_scope: e.target.value }))}
                  className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)]">
                  <option value="online">Online students only</option>
                  <option value="">All students</option>
                </select>
                <p className="text-[12px] text-[var(--ink-faint)] mt-1">Course materials are usually for online students.</p>
              </div>
            )}
          </div>
        )}

        {form.is_template && (
          <div className="bg-[var(--accent-soft)] rounded-xl p-3 mb-4">
            <p className="text-xs font-semibold text-[var(--accent)] mb-2">Available template fields (use in your PDF):</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_FIELDS.map(f => (
                <code key={f} className="text-[12px] bg-white border border-blue-200 text-[var(--accent)] px-2 py-0.5 rounded font-mono">{f}</code>
              ))}
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept=".pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading || !form.name}
          className="flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:brightness-110 transition">
          
          {uploading ? 'Uploading...' : 'Choose PDF & Upload'}
        </button>
      </div>

      {/* Send modal */}
      {(
        <Modal open={!!sendModal} onClose={() => setSendModal(null)} maxWidth="max-w-md">
          <div className="p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[var(--ink)]">Send to Students</h2>
              <button onClick={() => setSendModal(null)} className="text-[var(--ink-faint)] hover:text-[var(--ink-soft)]"></button>
            </div>
            <p className="text-sm text-[var(--ink-faint)] mb-4">Select students to send <strong>{sendModal?.name}</strong> via email.</p>

            {/* Select all */}
            <label className="flex items-center gap-2 mb-3 pb-3 border-b border-[var(--line-soft)] cursor-pointer">
              <input type="checkbox"
                checked={selectedStudents.length === students.length && students.length > 0}
                onChange={e => setSelectedStudents(e.target.checked ? students.map(s => s.id) : [])}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-semibold text-[var(--ink-soft)]">Select All ({students.length})</span>
            </label>

            <div className="overflow-y-auto flex-1 space-y-1 mb-4">
              {students.map(s => (
                <label key={s.id} className="flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-[var(--line-soft)] cursor-pointer">
                  <input type="checkbox"
                    checked={selectedStudents.includes(s.id)}
                    onChange={e => setSelectedStudents(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}
                    className="w-4 h-4 accent-blue-600" />
                  <div className="w-8 h-8 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] font-bold text-xs flex-shrink-0">
                    {s.full_name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[var(--ink)]">{s.full_name}</div>
                    <div className="text-xs text-[var(--ink-faint)]">{s.email}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={sendToStudents} disabled={sending || !selectedStudents.length}
                className="flex-1 h-11 bg-[var(--accent)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:brightness-110 transition flex items-center justify-center gap-2">
                
                {sending ? 'Sending...' : `Send to ${selectedStudents.length} student${selectedStudents.length !== 1 ? 's' : ''}`}
              </button>
              <button onClick={() => setSendModal(null)} className="flex-1 h-11 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Document grid */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full spin" /></div>
      ) : docs.length === 0 ? (
        <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-16 text-center text-[var(--ink-faint)]">
          
          <p>No documents yet. Upload your first PDF above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {docs.map(doc => (
            <div key={doc.id} className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--danger-soft)] flex items-center justify-center flex-shrink-0">
                  
                </div>
                <div className="flex gap-1 ml-2">
                  {doc.is_template && (
                    <span className="text-[10px] font-bold bg-[var(--accent-soft)] text-[var(--accent)] px-2 py-0.5 rounded-full">Template</span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLORS[doc.type] || TYPE_COLORS.other}`}>
                    {DOC_TYPES.find(t => t.value === doc.type)?.label || doc.type}
                  </span>
                </div>
              </div>

              <h3 className="font-semibold text-[var(--ink)] mb-0.5 text-sm">{doc.name}</h3>
              {doc.description && <p className="text-xs text-[var(--ink-faint)] mb-2 line-clamp-2">{doc.description}</p>}
              <p className="text-[10px] text-[var(--ink-faint)] mb-4">{formatDateTime(doc.created_at)} · {doc.file_name}</p>

              <div className="flex gap-2">
                <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 h-9 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-xs font-semibold hover:bg-[var(--line)] transition">
                   View
                </a>
                <button onClick={() => openSendModal(doc)}
                  className="flex-1 flex items-center justify-center gap-1.5 h-9 bg-[var(--accent)] text-white rounded-xl text-xs font-semibold hover:brightness-110 transition">
                   Send
                </button>
                <button onClick={() => deleteDoc(doc.id, doc.file_url)}
                  className="h-9 w-9 flex items-center justify-center bg-[var(--danger-soft)] text-[var(--danger)] rounded-xl hover:bg-[var(--danger-soft)] transition">
                  
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
