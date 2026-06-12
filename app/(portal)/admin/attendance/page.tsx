'use client'
import { CONFIG } from '@/lib/config'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { formatDateTime } from '@/lib/utils'
import { Users, CheckCircle, XCircle, Download, RefreshCw, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/shared/Modal'

export default function AttendanceDashboard() {
  const [selected, setSelected]   = useState<any>(null)
  const [creating, setCreating]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [userId, setUserId]       = useState<string | null>(null)
  const [newSession, setNewSession] = useState({ batch_id: '', class_code: '' })

  const { data: sessions, loading, refetch: refetchSessions } = useData<any>({
    table: 'class_sessions',
    select: '*, batches(name, courses(name))',
    orderBy: 'created_at',
    orderAsc: false,
    limit: 20,
  })

  const { data: batches } = useData<any>({
    table: 'batches',
    select: '*, courses(name)',
    orderBy: 'created_at',
    orderAsc: false,
    limit: 100,
  })

  const { data: signins, refetch: refetchSignins } = useData<any>({
    table: 'class_signins',
    select: '*, marketer:marketer_id(full_name)',
    filters: selected ? [{ col: 'session_id', op: 'eq', val: selected.id }] : [],
    orderBy: 'created_at',
    orderAsc: false,
    limit: 200,
    enabled: !!selected,
  })

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(s => setUserId(s?.userId || null)).catch(() => {})
  }, [])

  // Light polling while a session is selected, to mimic realtime
  useEffect(() => {
    if (!selected) return
    const id = setInterval(() => { refetchSignins(); refetchSessions() }, 8000)
    return () => clearInterval(id)
  }, [selected?.id])

  async function selectSession(s: any) {
    setSelected(s)
  }

  async function createSession() {
    if (!newSession.batch_id || !newSession.class_code.trim()) {
      toast.error('Select a batch and enter a class code')
      return
    }
    setSubmitting(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const result = await mutate('POST', 'class_sessions', {
        batch_id: newSession.batch_id,
        class_code: newSession.class_code.toUpperCase(),
        session_date: today,
        signin_open: true,
        created_by: userId,
      })
      toast.success('Session created! Share the sign-in link.')
      setCreating(false)
      setNewSession({ batch_id: '', class_code: '' })
      await refetchSessions()
      const created = Array.isArray(result) ? result[0] : result
      if (created) setSelected(created)
    } catch (e: any) {
      toast.error(e.message || 'Failed to create session')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleSession(id: string, open: boolean) {
    try {
      await mutate('PATCH', 'class_sessions', { signin_open: !open }, [{ col: 'id', val: id }])
      toast.success(open ? 'Sign-in closed' : 'Sign-in reopened')
      await refetchSessions()
      if (selected?.id === id) setSelected({ ...selected, signin_open: !open })
    } catch (e: any) {
      toast.error(e.message || 'Failed to update session')
    }
  }

  async function markPaid(signinId: string) {
    try {
      await mutate('PATCH', 'class_signins', { payment_status: 'paid', paid_at: new Date().toISOString() }, [{ col: 'id', val: signinId }])
      toast.success('Marked as paid')
      await refetchSignins()
    } catch (e: any) {
      toast.error(e.message || 'Failed to update')
    }
  }

  function exportCSV() {
    if (!signins.length) return
    const rows = signins.map((s: any) => [
      s.full_name, s.phone || '', s.attendance_type, s.code_verified ? 'Verified' : 'Not verified',
      s.payment_status, s.payment_method || '', s.amount_paid || 0,
      s.marketer?.full_name || 'Direct',
      formatDateTime(s.created_at)
    ].map(v => `"${v}"`).join(','))
    const csv = 'Name,Phone,Type,Code,Payment,Method,Amount,Marketer,Time\n' + rows.join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `attendance-${selected?.session_date || 'export'}.csv`
    a.click()
  }

  function getSigninUrl(session: any) {
    return `${CONFIG.appUrl}/signin/${session?.batch_id}`
  }

  function copyLink(session: any) {
    navigator.clipboard.writeText(getSigninUrl(session))
    toast.success('Sign-in link copied!')
  }

  const verified = signins.filter((s: any) => s.code_verified)
  const paid     = signins.filter((s: any) => s.payment_status === 'paid')
  const inPerson = signins.filter((s: any) => s.attendance_type === 'in_person')

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">Live class sign-in monitoring</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
          <Plus size={16} /> Create Session
        </button>
      </div>

      {/* No batches warning */}
      {batches.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5 text-sm text-amber-800">
          <strong>No classes/batches found.</strong> Go to <span className="font-semibold">Academics → Courses</span> to add a course,
          then <span className="font-semibold">Academics → Classes</span> to create a batch. Once a batch exists, it will appear here.
        </div>
      )}

      {/* Create session modal */}
      {(
        <Modal open={creating} onClose={() => setCreating(false)} maxWidth="max-w-sm">
          <div className="p-6 relative">
            <button onClick={() => setCreating(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 transition">
              <X size={18} />
            </button>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Create Sign-in Session</h2>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Batch</label>
                <select value={newSession.batch_id} onChange={e => setNewSession(s => ({ ...s, batch_id: e.target.value }))}
                  className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-blue-500">
                  <option value="">Select batch...</option>
                  {batches.map((b: any) => <option key={b.id} value={b.id}>{b.name} — {b.courses?.name}</option>)}
                </select>
                {batches.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">No batches available. Create one in Academics → Classes first.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Class Code (write this on the board)</label>
                <input value={newSession.class_code} onChange={e => setNewSession(s => ({ ...s, class_code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. CCE-AB25" maxLength={12}
                  className="w-full h-14 px-4 rounded-xl border border-gray-200 text-xl font-bold text-center tracking-widest uppercase focus:outline-none focus:border-blue-500" />
                <p className="text-xs text-gray-400 mt-1 text-center">Write this on your board before sharing the link</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={createSession} disabled={submitting || batches.length === 0}
                className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                {submitting ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => setCreating(false)} className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Sessions list */}
        <div>
          <h2 className="text-sm font-bold text-gray-700 mb-3">Recent Sessions</h2>
          <div className="space-y-2">
            {sessions.map((s: any) => (
              <button key={s.id} onClick={() => selectSession(s)}
                className={`w-full text-left bg-white rounded-2xl border-2 p-4 transition ${selected?.id === s.id ? 'border-blue-600' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="flex items-start justify-between mb-1">
                  <div className="text-sm font-bold text-gray-900 truncate">{s.batches?.name}</div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-2 flex-shrink-0 ${s.signin_open ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {s.signin_open ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>
                <div className="text-xs text-gray-500">{s.batches?.courses?.name}</div>
                <div className="flex items-center gap-3 mt-2 text-xs">
                  <span className="font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold">{s.class_code}</span>
                  <span className="text-gray-400">{s.session_date}</span>
                </div>
                <div className="flex gap-3 mt-2 text-xs text-gray-500">
                  <span>✅ {s.total_signed_in} signed in</span>
                  <span>💰 {s.total_paid} paid</span>
                </div>
              </button>
            ))}
            {sessions.length === 0 && !loading && (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400">
                <p className="text-sm">No sessions yet. Create one to get started.</p>
              </div>
            )}
          </div>
        </div>

        {/* Sign-in detail */}
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
              <Users size={40} className="mx-auto mb-3 opacity-30" />
              <p>Select a session to view attendance</p>
            </div>
          ) : (
            <div>
              {/* Session header */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className="font-bold text-gray-900">{selected.batches?.name}</h2>
                    <p className="text-sm text-gray-500">{selected.batches?.courses?.name} · {selected.session_date}</p>
                    <p className="text-sm font-mono text-blue-600 mt-1">Code: <strong>{selected.class_code}</strong></p>
                  </div>
                  <button onClick={() => toggleSession(selected.id, selected.signin_open)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${selected.signin_open ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                    {selected.signin_open ? 'Close Sign-in' : 'Reopen Sign-in'}
                  </button>
                </div>

                {/* Sign-in link */}
                <div className="bg-blue-50 rounded-xl p-3 mb-3">
                  <p className="text-xs font-semibold text-blue-700 mb-1">Share this sign-in link with students:</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-blue-600 flex-1 break-all">{getSigninUrl(selected)}</code>
                    <button onClick={() => copyLink(selected)} className="flex-shrink-0 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition">Copy</button>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Total', value: signins.length, color: 'text-gray-900' },
                    { label: 'Verified', value: verified.length, color: 'text-green-600' },
                    { label: 'In Person', value: inPerson.length, color: 'text-blue-600' },
                    { label: 'Paid', value: paid.length, color: 'text-emerald-600' },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 rounded-xl p-2.5 text-center">
                      <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-xs text-gray-500">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sign-in list */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <span className="text-sm font-bold text-gray-900">{signins.length} sign-ins</span>
                  <div className="flex gap-2">
                    <button onClick={() => refetchSignins()} className="p-2 text-gray-400 hover:text-gray-700 transition">
                      <RefreshCw size={15} />
                    </button>
                    <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-200 transition">
                      <Download size={13} /> Export
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Name', 'Phone', 'Type', 'Code', 'Payment', 'Marketer', 'Time'].map(h => (
                          <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {signins.map((s: any) => (
                        <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50">
                          <td className="px-3 py-2.5 text-sm font-semibold text-gray-900">{s.full_name}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-600">{s.phone?.replace(/^233/, '0') || '—'}</td>
                          <td className="px-3 py-2.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.attendance_type === 'online' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                              {s.attendance_type === 'online' ? 'Online' : 'In Person'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {s.code_verified
                              ? <CheckCircle size={16} className="text-green-500" />
                              : <XCircle size={16} className="text-red-400" />}
                          </td>
                          <td className="px-3 py-2.5">
                            {s.payment_status === 'paid' ? (
                              <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Paid</span>
                            ) : s.payment_method === 'cash' ? (
                              <button onClick={() => markPaid(s.id)} className="text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full hover:bg-orange-200 transition">
                                Cash — Mark Paid
                              </button>
                            ) : (
                              <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Pending</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-500">{s.marketer?.full_name?.split(' ')[0] || '—'}</td>
                          <td className="px-3 py-2.5 text-[10px] text-gray-400">{new Date(s.created_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}</td>
                        </tr>
                      ))}
                      {signins.length === 0 && (
                        <tr><td colSpan={7} className="text-center py-10 text-gray-400 text-sm">No sign-ins yet. Waiting for students...</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
