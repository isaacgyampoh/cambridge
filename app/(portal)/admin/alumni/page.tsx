'use client'
import { useState, useEffect, useRef } from 'react'
import { useData, mutate, mutateDelete } from '@/hooks/useData'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Plus, Star, GraduationCap, Briefcase, X, Eye, EyeOff } from 'lucide-react'
import { formatDate } from '@/lib/utils'

const EMPTY_FORM = {
  full_name: '', email: '', phone: '', photo_url: '',
  course_completed: '', batch_name: '', graduation_date: '',
  certification_number: '', current_job_title: '', current_company: '',
  linkedin_url: '', success_story: '', testimonial: '',
  video_url: '', is_featured: false, is_published: false,
}

export default function AlumniPage() {
  const { data: alumni, loading, refetch: load } = useData<any>({
    table: 'alumni', orderBy: 'graduation_date', orderAsc: false, limit: 500,
  })
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const sb = createClient()

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(s => setUserId(s?.userId || null)).catch(() => {})
  }, [])

  function openNew() {
    setForm({ ...EMPTY_FORM }); setEditId(null); setModal(true)
  }

  function openEdit(a: any) {
    setForm({ ...EMPTY_FORM, ...a }); setEditId(a.id); setModal(true)
  }

  async function uploadPhoto(file: File) {
    setUploading(true)
    const path = `alumni/${Date.now()}-${file.name.replace(/\s+/g, '-')}`
    const { error } = await sb.storage.from('alumni-photos').upload(path, file, { contentType: file.type })
    if (error) { toast.error('Upload failed'); setUploading(false); return }
    const { data: { publicUrl } } = sb.storage.from('alumni-photos').getPublicUrl(path)
    setForm(f => ({ ...f, photo_url: publicUrl }))
    setUploading(false)
    toast.success('Photo uploaded!')
  }

  async function save() {
    if (!form.full_name || !form.course_completed) { toast.error('Name and course are required'); return }
    setSaving(true)
    try {
      const payload = { ...form, added_by: userId, graduation_date: form.graduation_date || null }
      if (editId) await mutate('PATCH', 'alumni', payload, [{ col: 'id', val: editId }])
      else await mutate('POST', 'alumni', payload)
      toast.success(editId ? 'Alumni updated!' : 'Alumni added!')
      setModal(false); load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function togglePublish(id: string, current: boolean) {
    try { await mutate('PATCH', 'alumni', { is_published: !current }, [{ col: 'id', val: id }]); load() }
    catch (e: any) { toast.error(e.message || 'Failed to update') }
  }

  async function toggleFeatured(id: string, current: boolean) {
    try { await mutate('PATCH', 'alumni', { is_featured: !current }, [{ col: 'id', val: id }]); load() }
    catch (e: any) { toast.error(e.message || 'Failed to update') }
  }

  async function del(id: string) {
    if (!confirm('Delete this alumni record?')) return
    try { await mutateDelete('alumni', [{ col: 'id', val: id }]); load() }
    catch (e: any) { toast.error(e.message || 'Failed to delete') }
  }

  const FIELD_GROUPS = [
    {
      title: 'Personal Details',
      fields: [
        { key: 'full_name', label: 'Full Name *', type: 'text', placeholder: 'Kwame Mensah', half: false },
        { key: 'email', label: 'Email', type: 'email', placeholder: 'kwame@email.com', half: true },
        { key: 'phone', label: 'Phone', type: 'tel', placeholder: '024 000 0000', half: true },
      ]
    },
    {
      title: 'Academic Record',
      fields: [
        { key: 'course_completed', label: 'Course Completed *', type: 'text', placeholder: 'PMP Certification', half: false },
        { key: 'batch_name', label: 'Batch', type: 'text', placeholder: 'PMP March 2024', half: true },
        { key: 'graduation_date', label: 'Graduation Date', type: 'date', placeholder: '', half: true },
        { key: 'certification_number', label: 'Certificate No.', type: 'text', placeholder: 'CCE-2024-001', half: false },
      ]
    },
    {
      title: 'Current Position',
      fields: [
        { key: 'current_job_title', label: 'Job Title', type: 'text', placeholder: 'Project Manager', half: true },
        { key: 'current_company', label: 'Company', type: 'text', placeholder: 'Accra Metropolitan Assembly', half: true },
        { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url', placeholder: 'https://linkedin.com/in/...', half: false },
        { key: 'video_url', label: 'Video Testimonial URL', type: 'url', placeholder: 'YouTube or Vimeo link', half: false },
      ]
    },
  ]

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alumni & Success Stories</h1>
          <p className="text-gray-500 text-sm mt-0.5">{alumni.length} alumni · {alumni.filter(a => a.is_featured).length} featured</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
          <Plus size={16} /> Add Alumni
        </button>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto p-4 flex items-start sm:items-center justify-center">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl my-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">{editId ? 'Edit' : 'Add'} Alumni</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {/* Photo */}
            <div className="flex items-center gap-4 mb-5 pb-5 border-b border-gray-100">
              <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                {form.photo_url
                  ? <img src={form.photo_url} alt="" className="w-full h-full object-cover" />
                  : <GraduationCap size={32} className="text-gray-400" />}
              </div>
              <div>
                <input ref={photoRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }} />
                <button onClick={() => photoRef.current?.click()} disabled={uploading}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">
                  {uploading ? 'Uploading...' : 'Upload Photo'}
                </button>
                <p className="text-xs text-gray-400 mt-1">Or paste URL below</p>
                <input value={form.photo_url} onChange={e => setForm(f => ({ ...f, photo_url: e.target.value }))}
                  placeholder="https://..." className="mt-1 h-8 px-3 rounded-lg border border-gray-200 text-xs w-full focus:outline-none" />
              </div>
            </div>

            {/* Field groups */}
            {FIELD_GROUPS.map(group => (
              <div key={group.title} className="mb-5">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{group.title}</h3>
                <div className="grid grid-cols-2 gap-3">
                  {group.fields.map(f => (
                    <div key={f.key} className={f.half ? '' : 'col-span-2'}>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
                      <input type={f.type} value={(form as any)[f.key] || ''} placeholder={f.placeholder}
                        onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Story & Testimonial */}
            <div className="mb-5">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Story & Testimonial</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Success Story</label>
                  <textarea value={form.success_story} onChange={e => setForm(f => ({ ...f, success_story: e.target.value }))}
                    rows={3} placeholder="How did Cambridge change their career path? What did they achieve?"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Testimonial (their words)</label>
                  <textarea value={form.testimonial} onChange={e => setForm(f => ({ ...f, testimonial: e.target.value }))}
                    rows={2} placeholder={`"Cambridge CE transformed my career..."`}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>

            {/* Visibility */}
            <div className="flex gap-4 mb-5 p-4 bg-gray-50 rounded-xl">
              {[
                { key: 'is_published', label: 'Published', sub: 'Visible to students' },
                { key: 'is_featured', label: 'Featured', sub: 'Shown prominently' },
              ].map(opt => (
                <label key={opt.key} className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={(form as any)[opt.key]}
                    onChange={e => setForm(f => ({ ...f, [opt.key]: e.target.checked }))}
                    className="w-4 h-4 accent-blue-600" />
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{opt.label}</div>
                    <div className="text-xs text-gray-400">{opt.sub}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={save} disabled={saving}
                className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-700 transition">
                {saving ? 'Saving...' : editId ? 'Update Alumni' : 'Add Alumni'}
              </button>
              <button onClick={() => setModal(false)} className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Alumni grid */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {alumni.map(a => (
            <div key={a.id} className={`bg-white rounded-2xl border-2 overflow-hidden transition ${a.is_featured ? 'border-yellow-300' : 'border-gray-200'}`}>
              {/* Cover / photo */}
              <div className="h-24 bg-gradient-to-br from-blue-600 to-blue-800 relative flex items-end px-4 pb-3">
                {a.is_featured && (
                  <div className="absolute top-2 right-2 bg-yellow-400 rounded-full p-1">
                    <Star size={14} className="text-yellow-900" fill="currentColor" />
                  </div>
                )}
                <div className="w-14 h-14 rounded-full border-3 border-white overflow-hidden bg-blue-200 flex-shrink-0 absolute -bottom-7 left-4">
                  {a.photo_url
                    ? <img src={a.photo_url} alt={a.full_name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-blue-600 font-bold text-xl">{a.full_name.charAt(0)}</div>}
                </div>
              </div>

              <div className="pt-9 px-4 pb-4">
                <h3 className="font-bold text-gray-900">{a.full_name}</h3>
                {(a.current_job_title || a.current_company) && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                    <Briefcase size={11} />
                    <span>{[a.current_job_title, a.current_company].filter(Boolean).join(' at ')}</span>
                  </div>
                )}
                <div className="flex items-center gap-1 text-xs text-blue-600 mt-0.5">
                  <GraduationCap size={11} />
                  <span>{a.course_completed} · {formatDate(a.graduation_date)}</span>
                </div>

                {a.testimonial && (
                  <blockquote className="text-xs text-gray-500 italic mt-3 line-clamp-2 border-l-2 border-blue-200 pl-2">
                    "{a.testimonial}"
                  </blockquote>
                )}

                <div className="flex gap-2 mt-4">
                  <button onClick={() => openEdit(a)}
                    className="flex-1 h-9 bg-gray-100 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-200 transition">Edit</button>
                  <button onClick={() => toggleFeatured(a.id, a.is_featured)}
                    className={`h-9 w-9 flex items-center justify-center rounded-xl transition ${a.is_featured ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                    <Star size={15} fill={a.is_featured ? 'currentColor' : 'none'} />
                  </button>
                  <button onClick={() => togglePublish(a.id, a.is_published)}
                    className={`h-9 w-9 flex items-center justify-center rounded-xl transition ${a.is_published ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                    {a.is_published ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <button onClick={() => del(a.id)}
                    className="h-9 w-9 flex items-center justify-center bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition text-xs">✕</button>
                </div>
              </div>
            </div>
          ))}
          {alumni.length === 0 && (
            <div className="col-span-3 bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
              <GraduationCap size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No alumni yet</p>
              <p className="text-sm mt-1">Add your first success story to inspire prospective students</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
