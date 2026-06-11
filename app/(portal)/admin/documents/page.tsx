'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Upload, FileText, Download, Trash2, Send, X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

const DOC_TYPES = [
  { value: 'admission_letter', label: 'Admission Letter' },
  { value: 'brochure', label: 'School Brochure' },
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'receipt', label: 'Receipt Template' },
  { value: 'application_form', label: 'Application Form' },
  { value: 'certificate', label: 'Certificate Template' },
  { value: 'other', label: 'Other Document' },
]

const TEMPLATE_FIELDS = ['{{full_name}}', '{{email}}', '{{phone}}', '{{course}}', '{{batch}}', '{{date}}', '{{admission_number}}', '{{amount}}']

export default function DocumentsPage() {
  const [docs, setDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [sendModal, setSendModal] = useState<any>(null)
  const [students, setStudents] = useState<any[]>([])
  const [selectedStudents, setSelectedStudents] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({ name: '', type: 'admission_letter', description: '', is_template: false })
  const sb = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await sb.from('documents').select('*').order('created_at', { ascending: false })
    setDocs(data || [])
    setLoading(false)
  }

  async function upload(file: File) {
    if (!form.name) { toast.error('Enter a document name first'); return }
    setUploading(true)

    const { data: { user } } = await sb.auth.getUser()
    const path = `documents/${Date.now()}-${file.name.replace(/\s+/g, '-')}`

    const { data: uploadData, error: uploadError } = await sb.storage
      .from('documents')
      .upload(path, file, { contentType: 'application/pdf' })

    if (uploadError) { toast.error('Upload failed: ' + uploadError.message); setUploading(false); return }

    const { data: { publicUrl } } = sb.storage.from('documents').getPublicUrl(path)

    const { error } = await sb.from('documents').insert({
      name: form.name,
      type: form.type,
      description: form.description || null,
      file_url: publicUrl,
      file_name: file.name,
      file_size: file.size,
      is_template: form.is_template,
      template_fields: form.is_template ? TEMPLATE_FIELDS : null,
      uploaded_by: user?.id,
    })

    if (error) { toast.error(error.message); setUploading(false); return }
    toast.success('Document uploaded!')
    setForm({ name: '', type: 'admission_letter', description: '', is_template: false })
    setUploading(false)
    load()
  }

  async function deleteDoc(id: string, fileUrl: string) {
    if (!confirm('Delete this document?')) return
    await sb.from('documents').delete().eq('id', id)
    // Extract path from URL and delete from storage
    const path = fileUrl.split('/storage/v1/object/public/documents/')[1]
    if (path) await sb.storage.from('documents').remove([path])
    toast.success('Document deleted')
    load()
  }

  async function openSendModal(doc: any) {
    setSendModal(doc)
    const { data } = await sb.from('profiles').select('id, full_name, email, phone').eq('role', 'student').eq('is_active', true).order('full_name')
    setStudents(data || [])
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
    admission_letter: 'bg-blue-100 text-blue-700',
    brochure: 'bg-purple-100 text-purple-700',
    offer_letter: 'bg-green-100 text-green-700',
    receipt: 'bg-yellow-100 text-yellow-700',
    application_form: 'bg-orange-100 text-orange-700',
    certificate: 'bg-pink-100 text-pink-700',
    other: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Document Library</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage PDF templates and official documents</p>
        </div>
      </div>

      {/* Upload section */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-4">Upload New Document</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Document name (e.g. Admission Letter 2025)"
            className="h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            className="h-11 px-4 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-blue-500">
            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Description (optional)"
            className="h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
          <label className="flex items-center gap-3 px-4 h-11 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={form.is_template} onChange={e => setForm(f => ({ ...f, is_template: e.target.checked }))}
              className="w-4 h-4 accent-blue-600" />
            <div>
              <div className="text-sm font-medium text-gray-900">Personalizable template</div>
              <div className="text-xs text-gray-400">Can be auto-filled with student data</div>
            </div>
          </label>
        </div>

        {form.is_template && (
          <div className="bg-blue-50 rounded-xl p-3 mb-4">
            <p className="text-xs font-semibold text-blue-700 mb-2">Available template fields (use in your PDF):</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_FIELDS.map(f => (
                <code key={f} className="text-[11px] bg-white border border-blue-200 text-blue-600 px-2 py-0.5 rounded font-mono">{f}</code>
              ))}
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept=".pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading || !form.name}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-700 transition">
          <Upload size={16} />
          {uploading ? 'Uploading...' : 'Choose PDF & Upload'}
        </button>
      </div>

      {/* Send modal */}
      {sendModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Send to Students</h2>
              <button onClick={() => setSendModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Select students to send <strong>{sendModal.name}</strong> via email.</p>

            {/* Select all */}
            <label className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100 cursor-pointer">
              <input type="checkbox"
                checked={selectedStudents.length === students.length && students.length > 0}
                onChange={e => setSelectedStudents(e.target.checked ? students.map(s => s.id) : [])}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-semibold text-gray-700">Select All ({students.length})</span>
            </label>

            <div className="overflow-y-auto flex-1 space-y-1 mb-4">
              {students.map(s => (
                <label key={s.id} className="flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox"
                    checked={selectedStudents.includes(s.id)}
                    onChange={e => setSelectedStudents(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}
                    className="w-4 h-4 accent-blue-600" />
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs flex-shrink-0">
                    {s.full_name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">{s.full_name}</div>
                    <div className="text-xs text-gray-400">{s.email}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={sendToStudents} disabled={sending || !selectedStudents.length}
                className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-700 transition flex items-center justify-center gap-2">
                <Send size={16} />
                {sending ? 'Sending...' : `Send to ${selectedStudents.length} student${selectedStudents.length !== 1 ? 's' : ''}`}
              </button>
              <button onClick={() => setSendModal(null)} className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Document grid */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
      ) : docs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>No documents yet. Upload your first PDF above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {docs.map(doc => (
            <div key={doc.id} className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                  <FileText size={20} className="text-red-600" />
                </div>
                <div className="flex gap-1 ml-2">
                  {doc.is_template && (
                    <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Template</span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLORS[doc.type] || TYPE_COLORS.other}`}>
                    {DOC_TYPES.find(t => t.value === doc.type)?.label || doc.type}
                  </span>
                </div>
              </div>

              <h3 className="font-bold text-gray-900 mb-0.5 text-sm">{doc.name}</h3>
              {doc.description && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{doc.description}</p>}
              <p className="text-[10px] text-gray-400 mb-4">{formatDateTime(doc.created_at)} · {doc.file_name}</p>

              <div className="flex gap-2">
                <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 h-9 bg-gray-100 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-200 transition">
                  <Download size={13} /> View
                </a>
                <button onClick={() => openSendModal(doc)}
                  className="flex-1 flex items-center justify-center gap-1.5 h-9 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition">
                  <Send size={13} /> Send
                </button>
                <button onClick={() => deleteDoc(doc.id, doc.file_url)}
                  className="h-9 w-9 flex items-center justify-center bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
