'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'
import { formatDate, formatGHS } from '@/lib/utils'
import { BookOpen, DollarSign, Calendar, User } from 'lucide-react'

export default function StudentDashboard() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [batches, setBatches] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [attendance, setAttendance] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const sb = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return
      const { data: p } = await sb.from('profiles').select('*').eq('id', user.id).single()
      setProfile(p)

      const [{ data: b }, { data: i }, { data: a }] = await Promise.all([
        sb.from('batch_students').select('*, batch:batch_id(*, courses(*))').eq('student_id', user.id),
        sb.from('invoices').select('*').eq('student_id', user.id).order('created_at', { ascending: false }),
        sb.from('attendance').select('*').eq('student_id', user.id).order('date', { ascending: false }).limit(10),
      ])
      setBatches(b || []); setInvoices(i || []); setAttendance(a || [])
      setLoading(false)
    }
    load()
  }, [])

  const totalOwed = invoices.reduce((a, i) => a + Number(i.outstanding), 0)
  const presentDays = attendance.filter(a => a.status === 'present').length

  if (loading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>

  return (
    <div className="fade-in">
      {/* Welcome */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 mb-6 text-white">
        <div className="text-sm font-medium opacity-80 mb-1">Welcome back,</div>
        <div className="text-2xl font-bold">{profile?.full_name?.split(' ')[0]} 👋</div>
        <div className="text-sm opacity-70 mt-1">Cambridge Centre of Excellence</div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Enrolled Classes', value: batches.length, icon: BookOpen, color: 'text-blue-600 bg-blue-50' },
          { label: 'Days Attended', value: presentDays, icon: Calendar, color: 'text-green-600 bg-green-50' },
          { label: 'Outstanding', value: formatGHS(totalOwed), icon: DollarSign, color: totalOwed > 0 ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50' },
          { label: 'Invoices', value: invoices.length, icon: DollarSign, color: 'text-purple-600 bg-purple-50' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className={`w-10 h-10 rounded-xl ${s.color.split(' ')[1]} flex items-center justify-center mb-3`}>
              <s.icon size={20} className={s.color.split(' ')[0]} />
            </div>
            <div className="text-xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* My classes */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">My Classes</h3>
          {batches.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Not enrolled in any classes yet</p>
          ) : batches.map(e => {
            const batch = e.batch
            const course = batch?.courses
            return (
              <div key={e.id} className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <BookOpen size={18} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{course?.name}</div>
                  <div className="text-xs text-gray-500">{batch?.name}</div>
                  <div className="text-xs text-gray-400">{formatDate(batch?.start_date)} · {batch?.schedule || 'Schedule TBD'}</div>
                </div>
                <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${batch?.status === 'ongoing' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                  {batch?.status}
                </span>
              </div>
            )
          })}
        </div>

        {/* Invoices */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">My Invoices</h3>
          {invoices.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No invoices yet</p>
          ) : invoices.map(inv => (
            <div key={inv.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
              <div>
                <div className="text-xs font-mono text-gray-400">{inv.invoice_number}</div>
                <div className="text-sm font-semibold text-gray-900">{formatGHS(inv.total_amount)}</div>
                {inv.due_date && <div className="text-xs text-gray-400">Due: {formatDate(inv.due_date)}</div>}
              </div>
              <div className="text-right">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${Number(inv.outstanding) === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {Number(inv.outstanding) === 0 ? 'Paid' : `Owes ${formatGHS(inv.outstanding)}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
