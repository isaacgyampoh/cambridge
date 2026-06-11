'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Upload, FileText, CheckCircle, XCircle, AlertTriangle, Download } from 'lucide-react'
import Link from 'next/link'

interface ParsedLead {
  full_name: string
  phone: string
  email: string
  course_interest: string
  source: string
  city: string
  notes: string
  status: 'valid' | 'error'
  error?: string
}

const TEMPLATE_CSV = `full_name,phone,email,course_interest,source,city,notes
Kwame Mensah,0241234567,kwame@email.com,PMP,facebook,Accra,Interested in weekend classes
Abena Owusu,0551234567,abena@email.com,Data Analytics,google,Kumasi,
John Doe,0201234567,,PRINCE2,manual,Takoradi,Called office`

export default function ImportLeadsPage() {
  const router  = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [raw,       setRaw]       = useState('')
  const [parsed,    setParsed]    = useState<ParsedLead[]>([])
  const [importing, setImporting] = useState(false)
  const [done,      setDone]      = useState<{ success: number; failed: number } | null>(null)

  const VALID_SOURCES = ['facebook','google','linkedin','website','referral','manual']

  function parseCSV(text: string): ParsedLead[] {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) return []

    // Detect header
    const firstLine = lines[0].toLowerCase()
    const hasHeader = firstLine.includes('full_name') || firstLine.includes('name') || firstLine.includes('phone')
    const dataLines = hasHeader ? lines.slice(1) : lines

    return dataLines.map((line, i) => {
      // Handle quoted CSV
      const cols: string[] = []
      let cur = '', inQ = false
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ }
        else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
        else cur += ch
      }
      cols.push(cur.trim())

      const [full_name='', phone='', email='', course_interest='', source='', city='', notes=''] = cols

      if (!full_name.trim()) return { full_name:'', phone, email, course_interest, source, city, notes, status: 'error', error: `Row ${i+2}: Name is required` }

      const cleanSource = source.toLowerCase().trim()
      const validSource = VALID_SOURCES.includes(cleanSource) ? cleanSource : 'manual'

      return {
        full_name: full_name.trim(),
        phone: phone.trim().replace(/\s+/g,'').replace(/^0/,'233'),
        email: email.trim(),
        course_interest: course_interest.trim(),
        source: validSource,
        city: city.trim(),
        notes: notes.trim(),
        status: 'valid',
      }
    })
  }

  function handleText(text: string) {
    setRaw(text)
    setDone(null)
    if (text.trim()) setParsed(parseCSV(text))
    else setParsed([])
  }

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => handleText(e.target?.result as string)
    reader.readAsText(file)
  }

  async function importLeads() {
    const valid = parsed.filter(p => p.status === 'valid')
    if (!valid.length) { toast.error('No valid leads to import'); return }
    setImporting(true)

    let success = 0, failed = 0
    const BATCH = 20

    for (let i = 0; i < valid.length; i += BATCH) {
      const batch = valid.slice(i, i + BATCH)
      try {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            table: 'leads',
            data: batch.map(l => ({
              full_name: l.full_name,
              phone: l.phone || null,
              email: l.email || null,
              course_interest: l.course_interest || null,
              source: l.source,
              status: 'new',
              city: l.city || null,
              notes: l.notes || null,
            })),
          }),
        })
        const d = await res.json()
        if (d.error) { failed += batch.length }
        else { success += batch.length }
      } catch { failed += batch.length }
    }

    setImporting(false)
    setDone({ success, failed })
    toast.success(`Import complete! ${success} leads imported.`)
  }

  function downloadTemplate() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }))
    a.download = 'cambridge-leads-template.csv'
    a.click()
  }

  const validCount = parsed.filter(p => p.status === 'valid').length
  const errorCount = parsed.filter(p => p.status === 'error').length

  return (
    <div className="w-full fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/leads"
          className="flex items-center gap-1.5 h-9 px-3 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
          <ArrowLeft size={15} /> Leads
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Import Leads</h1>
          <p className="text-gray-400 text-sm">Upload a CSV file or paste data to import multiple leads at once</p>
        </div>
      </div>

      {done ? (
        /* ── Success state ── */
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center max-w-md mx-auto shadow-sm">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Import Complete!</h2>
          <div className="flex justify-center gap-6 mb-6 text-sm">
            <div className="text-center">
              <div className="text-2xl font-black text-green-600">{done.success}</div>
              <div className="text-gray-400">Imported</div>
            </div>
            {done.failed > 0 && (
              <div className="text-center">
                <div className="text-2xl font-black text-red-500">{done.failed}</div>
                <div className="text-gray-400">Failed</div>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Link href="/admin/leads"
              className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition flex items-center justify-center">
              View Leads →
            </Link>
            <button onClick={() => { setDone(null); setParsed([]); setRaw('') }}
              className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">
              Import More
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Left — input */}
          <div className="space-y-4">
            {/* Template download */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center gap-3">
              <FileText size={20} className="text-blue-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-blue-900">Need a template?</div>
                <div className="text-xs text-blue-600">Columns: full_name, phone, email, course_interest, source, city, notes</div>
              </div>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition flex-shrink-0">
                <Download size={13} /> Template
              </button>
            </div>

            {/* File upload */}
            <div>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              <button onClick={() => fileRef.current?.click()}
                className="w-full h-28 border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all">
                <Upload size={24} />
                <span className="text-sm font-semibold">Click to upload CSV file</span>
                <span className="text-xs">or drag & drop</span>
              </button>
            </div>

            {/* Paste area */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Or paste CSV data directly
              </label>
              <textarea
                value={raw}
                onChange={e => handleText(e.target.value)}
                rows={12}
                placeholder={`full_name,phone,email,course_interest,source,city,notes\nKwame Mensah,0241234567,kwame@email.com,PMP,facebook,Accra,Interested in weekend classes\nAbena Owusu,0551234567,,Data Analytics,google,Kumasi,`}
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm font-mono resize-none focus:outline-none focus:border-blue-500 bg-gray-50 focus:bg-white transition"
              />
            </div>
          </div>

          {/* Right — preview */}
          <div className="space-y-4">
            {parsed.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-300 shadow-sm">
                <FileText size={36} className="mx-auto mb-3 opacity-50" />
                <p className="font-medium">Preview will appear here</p>
                <p className="text-sm mt-1">Upload or paste your CSV data</p>
              </div>
            ) : (
              <>
                {/* Stats bar */}
                <div className="flex gap-3">
                  <div className="flex-1 bg-green-50 border border-green-100 rounded-xl p-3 text-center">
                    <div className="text-xl font-black text-green-600">{validCount}</div>
                    <div className="text-xs text-green-600 font-semibold">Ready to import</div>
                  </div>
                  {errorCount > 0 && (
                    <div className="flex-1 bg-red-50 border border-red-100 rounded-xl p-3 text-center">
                      <div className="text-xl font-black text-red-500">{errorCount}</div>
                      <div className="text-xs text-red-500 font-semibold">Will be skipped</div>
                    </div>
                  )}
                  <div className="flex-1 bg-gray-50 border border-gray-100 rounded-xl p-3 text-center">
                    <div className="text-xl font-black text-gray-700">{parsed.length}</div>
                    <div className="text-xs text-gray-500 font-semibold">Total rows</div>
                  </div>
                </div>

                {/* Preview table */}
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-900">Preview</span>
                    <span className="text-xs text-gray-400">Showing first 20 rows</span>
                  </div>
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          {['', 'Name', 'Phone', 'Email', 'Course', 'Source'].map(h => (
                            <th key={h} className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide px-3 py-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.slice(0, 20).map((row, i) => (
                          <tr key={i} className={`border-t border-gray-50 ${row.status === 'error' ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                            <td className="px-3 py-2">
                              {row.status === 'valid'
                                ? <CheckCircle size={13} className="text-green-500" />
                                : <XCircle size={13} className="text-red-500" />}
                            </td>
                            <td className="px-3 py-2 text-xs font-semibold text-gray-900 max-w-32 truncate">{row.full_name || <span className="text-red-400 italic">missing</span>}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">{row.phone || '—'}</td>
                            <td className="px-3 py-2 text-xs text-gray-500 max-w-32 truncate">{row.email || '—'}</td>
                            <td className="px-3 py-2 text-xs text-gray-500 max-w-28 truncate">{row.course_interest || '—'}</td>
                            <td className="px-3 py-2">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize bg-gray-100 text-gray-600">{row.source}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Errors */}
                {errorCount > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-yellow-800 mb-2">
                      <AlertTriangle size={15} /> {errorCount} row{errorCount > 1 ? 's' : ''} will be skipped:
                    </div>
                    {parsed.filter(p => p.status === 'error').map((p, i) => (
                      <div key={i} className="text-xs text-yellow-700">{p.error}</div>
                    ))}
                  </div>
                )}

                {/* Import button */}
                <button onClick={importLeads} disabled={importing || validCount === 0}
                  className="w-full h-12 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
                  {importing
                    ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Importing {validCount} leads...</>
                    : <><Upload size={16} /> Import {validCount} Lead{validCount !== 1 ? 's' : ''}</>}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
