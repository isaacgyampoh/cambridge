'use client'
import { useState, useEffect } from 'react'
import { useData } from '@/hooks/useData'
import { formatGHS, formatDate } from '@/lib/utils'
import { BookOpen, DollarSign, Calendar } from 'lucide-react'

export default function StudentDashboard() {
  const [myId, setMyId] = useState<string|null>(null)
  const [myName, setMyName] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => {
      if (s.valid) { setMyId(s.userId); setMyName(s.fullName || '') }
    })
  }, [])

  const { data: enrollments } = useData({
    table: 'batch_students',
    select: '*, batch:batch_id(*, courses(name))',
    filters: myId ? [{ col: 'student_id', op: 'eq', val: myId }] : [],
    enabled: !!myId,
  })

  const { data: invoices } = useData({
    table: 'invoices',
    select: '*',
    filters: myId ? [{ col: 'student_id', op: 'eq', val: myId }] : [],
    orderBy: 'created_at',
    enabled: !!myId,
  })

  const totalOwed = invoices.reduce((a, i) => a + Number(i.outstanding || 0), 0)

  return (
    <div className="fade-in w-full">
      {/* Welcome banner */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-5 mb-5 text-white">
        <div className="text-sm opacity-70 mb-0.5">Welcome back,</div>
        <div className="text-2xl font-black">{myName.split(' ')[0] || 'Student'} </div>
        <div className="text-xs opacity-60 mt-1">Cambridge Centre of Excellence</div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Enrolled', value: enrollments.length, icon: BookOpen, color: 'text-blue-600 bg-blue-50'},
          { label: 'Invoices', value: invoices.length, icon: DollarSign, color: 'text-purple-600 bg-purple-50'},
          { label: 'Balance', value: formatGHS(totalOwed), icon: DollarSign, color: totalOwed > 0 ? 'text-red-600 bg-red-50': 'text-green-600 bg-green-50'},
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <div className={`w-9 h-9 rounded-xl ${s.color.split(' ')[1]} flex items-center justify-center mb-2 mx-auto`}>
              <s.icon size={17} className={s.color.split(' ')[0]} />
            </div>
            <div className="text-lg font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Classes */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-3">My Classes</h3>
        {enrollments.length === 0 ? (
          <p className="text-sm text-gray-300 text-center py-6">Not enrolled in any classes yet</p>
        ) : enrollments.map((e: any) => {
          const batch = e.batch
          return (
            <div key={e.id} className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
              <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                <BookOpen size={16} className="text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900">{batch?.courses?.name}</div>
                <div className="text-xs text-gray-400">{batch?.name} · {batch?.schedule || 'Schedule TBD'}</div>
                {batch?.start_date && <div className="text-xs text-gray-400">{formatDate(batch.start_date)}</div>}
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${batch?.status==='ongoing'?'bg-green-100 text-green-700':'bg-blue-100 text-blue-700'}`}>
                {batch?.status || 'upcoming'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Invoices */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-3">My Invoices</h3>
        {invoices.length === 0 ? (
          <p className="text-sm text-gray-300 text-center py-6">No invoices yet</p>
        ) : invoices.map(inv => (
          <div key={inv.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
            <div>
              <div className="text-xs font-mono text-gray-400">{inv.invoice_number || '—'}</div>
              <div className="text-sm font-bold text-gray-900">{formatGHS(inv.total_amount)}</div>
              {inv.due_date && <div className="text-xs text-gray-400">Due: {formatDate(inv.due_date)}</div>}
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${Number(inv.outstanding)===0?'bg-green-100 text-green-700':'bg-red-100 text-red-600'}`}>
              {Number(inv.outstanding)===0 ? 'Paid ': `Owes ${formatGHS(inv.outstanding)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
