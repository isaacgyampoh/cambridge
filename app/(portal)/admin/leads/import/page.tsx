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
Abena Owusu,0551234567,abena@email.com,Corporate Training,google,Kumasi,
John Doe,0201234567,,PHRI,manual,Takoradi,Called office`

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
          className="flex items-center gap-1.5 h-9 px-3 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-xl text-sm font-medium hover:bg-[var(--line-soft)] transition">
           Leads
        </Link>
        <div>
          <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Import Leads</h1>
          <p className="text-[var(--ink-faint)] text-sm">Upload a CSV file or paste data to import multiple leads at once</p>
        </div>
      </div>

      {done ? (
        /* ── Success state ── */
        <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-10 text-center max-w-md mx-auto shadow-sm">
          <div className="w-16 h-16 bg-[var(--ok-soft)] rounded-full flex items-center justify-center mx-auto mb-4">
            
          </div>
          <h2 className="font-display text-xl font-semibold text-[var(--ink)] mb-2">Import Complete!</h2>
          <div className="flex justify-center gap-6 mb-6 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-[var(--ok)]">{done.success}</div>
              <div className="text-[var(--ink-faint)]">Imported</div>
            </div>
            {done.failed > 0 && (
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--danger)]">{done.failed}</div>
                <div className="text-[var(--ink-faint)]">Failed</div>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Link href="/admin/leads"
              className="flex-1 h-11 bg-[var(--accent)] text-white rounded-xl text-sm font-bold hover:brightness-110 transition flex items-center justify-center">
              View Leads
            </Link>
            <button onClick={() => { setDone(null); setParsed([]); setRaw('') }}
              className="flex-1 h-11 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition">
              Import More
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Left — input */}
          <div className="space-y-4">
            {/* Template download */}
            <div className="bg-[var(--accent-soft)] border border-blue-100 rounded-2xl p-4 flex items-center gap-3">
              
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-blue-900">Need a template?</div>
                <div className="text-xs text-[var(--accent)]">Columns: full_name, phone, email, course_interest, source, city, notes</div>
              </div>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-2 bg-[var(--accent)] text-white rounded-xl text-xs font-bold hover:brightness-110 transition flex-shrink-0">
                 Template
              </button>
            </div>

            {/* File upload */}
            <div>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              <button onClick={() => fileRef.current?.click()}
                className="w-full h-28 border-2 border-dashed border-[var(--line)] rounded-2xl flex flex-col items-center justify-center gap-2 text-[var(--ink-faint)] hover:border-blue-400 hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all">
                
                <span className="text-sm font-semibold">Click to upload CSV file</span>
                <span className="text-xs">or drag & drop</span>
              </button>
            </div>

            {/* Paste area */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase tracking-wide mb-2">
                Or paste CSV data directly
              </label>
              <textarea
                value={raw}
                onChange={e => handleText(e.target.value)}
                rows={12}
                placeholder={`full_name,phone,email,course_interest,source,city,notes\nKwame Mensah,0241234567,kwame@email.com,PMP,facebook,Accra,Interested in weekend classes\nAbena Owusu,0551234567,,PHRI,google,Kumasi,`}
                className="w-full px-4 py-3 rounded-2xl border border-[var(--line)] text-sm font-mono resize-none focus:outline-none focus:border-[var(--accent)] bg-[var(--line-soft)] focus:bg-white transition"
              />
            </div>
          </div>

          {/* Right — preview */}
          <div className="space-y-4">
            {parsed.length === 0 ? (
              <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-12 text-center text-[var(--ink-faint)] shadow-sm">
                
                <p className="font-medium">Preview will appear here</p>
                <p className="text-sm mt-1">Upload or paste your CSV data</p>
              </div>
            ) : (
              <>
                {/* Stats bar */}
                <div className="flex gap-3">
                  <div className="flex-1 bg-[var(--ok-soft)] border border-green-100 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-[var(--ok)]">{validCount}</div>
                    <div className="text-xs text-[var(--ok)] font-semibold">Ready to import</div>
                  </div>
                  {errorCount > 0 && (
                    <div className="flex-1 bg-[var(--danger-soft)] border border-red-100 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-[var(--danger)]">{errorCount}</div>
                      <div className="text-xs text-[var(--danger)] font-semibold">Will be skipped</div>
                    </div>
                  )}
                  <div className="flex-1 bg-[var(--line-soft)] border border-[var(--line-soft)] rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-[var(--ink-soft)]">{parsed.length}</div>
                    <div className="text-xs text-[var(--ink-faint)] font-semibold">Total rows</div>
                  </div>
                </div>

                {/* Preview table */}
                <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-[var(--line-soft)] flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--ink)]">Preview</span>
                    <span className="text-xs text-[var(--ink-faint)]">Showing first 20 rows</span>
                  </div>
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-[var(--line-soft)] sticky top-0">
                        <tr>
                          {['', 'Name', 'Phone', 'Email', 'Course', 'Source'].map(h => (
                            <th key={h} className="text-left text-[10px] font-bold text-[var(--ink-faint)] uppercase tracking-wide px-3 py-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.slice(0, 20).map((row, i) => (
                          <tr key={i} className={`border-t border-[var(--line-soft)] ${row.status === 'error' ? 'bg-[var(--danger-soft)]' : 'hover:bg-[var(--line-soft)]'}`}>
                            <td className="px-3 py-2">
                              {row.status === 'valid'
                                ? null : null}
                            </td>
                            <td className="px-3 py-2 text-xs font-semibold text-[var(--ink)] max-w-32 truncate">{row.full_name || <span className="text-red-400 italic">missing</span>}</td>
                            <td className="px-3 py-2 text-xs text-[var(--ink-faint)]">{row.phone || '—'}</td>
                            <td className="px-3 py-2 text-xs text-[var(--ink-faint)] max-w-32 truncate">{row.email || '—'}</td>
                            <td className="px-3 py-2 text-xs text-[var(--ink-faint)] max-w-28 truncate">{row.course_interest || '—'}</td>
                            <td className="px-3 py-2">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize bg-[var(--line-soft)] text-[var(--ink-soft)]">{row.source}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Errors */}
                {errorCount > 0 && (
                  <div className="bg-[var(--warn-soft)] border border-yellow-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-[var(--warn)] mb-2">
                       {errorCount} row{errorCount > 1 ? 's' : ''} will be skipped:
                    </div>
                    {parsed.filter(p => p.status === 'error').map((p, i) => (
                      <div key={i} className="text-xs text-[var(--warn)]">{p.error}</div>
                    ))}
                  </div>
                )}

                {/* Import button */}
                <button onClick={importLeads} disabled={importing || validCount === 0}
                  className="w-full h-12 bg-[var(--accent)] text-white rounded-xl text-sm font-bold hover:brightness-110 disabled:opacity-50 transition flex items-center justify-center gap-2">
                  {importing
                    ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Importing {validCount} leads...</>
                    : <> Import {validCount} Lead{validCount !== 1 ? 's' : ''}</>}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
