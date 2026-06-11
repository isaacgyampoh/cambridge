'use client'
import { useData, mutate } from '@/hooks/useData'
import { useState } from 'react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { RefreshCw } from 'lucide-react'

const S: Record<string,{label:string;color:string}> = {
  pending:{label:'Pending',color:'bg-yellow-100 text-yellow-800'},
  awaiting_forms:{label:'Awaiting Forms',color:'bg-blue-100 text-blue-700'},
  awaiting_payment:{label:'Awaiting Payment',color:'bg-orange-100 text-orange-700'},
  admitted:{label:'Admitted ✓',color:'bg-green-100 text-green-700'},
  rejected:{label:'Rejected',color:'bg-red-100 text-red-600'},
}

export default function AdminAdmissions() {
  const [filter, setFilter] = useState('all')
  const [acting, setActing] = useState<string|null>(null)
  const { data, loading, refetch } = useData({
    table: 'admissions',
    select: '*, lead:lead_id(full_name,phone,email,course_interest), course:course_id(name)',
    orderBy: 'created_at',
  })

  async function updateStatus(id: string, status: string) {
    setActing(id)
    await mutate('PATCH', 'admissions', { status }, [{ col: 'id', val: id }])
    toast.success('Updated'); setActing(null); refetch()
  }

  const filtered = filter === 'all' ? data : data.filter(a => a.status === filter)

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-5">
        <div><h1 className="text-2xl font-bold text-gray-900">All Admissions</h1></div>
        <button onClick={refetch} className="h-9 w-9 flex items-center justify-center bg-white border border-gray-200 text-gray-500 rounded-xl">
          <RefreshCw size={14} className={loading?'animate-spin':''} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {['all','pending','awaiting_forms','awaiting_payment','admitted','rejected'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`h-8 px-3 rounded-xl text-xs font-semibold capitalize transition ${filter===f?'bg-gray-900 text-white':'bg-white text-gray-500 border border-gray-200'}`}>
            {f.replace(/_/g,' ')}
          </button>
        ))}
      </div>
      {loading ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-3">
          {filtered.map(a => {
            const lead = a.lead; const sc = S[a.status]||S.pending
            return (
              <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-bold text-gray-900">{lead?.full_name||'—'} <span className="text-[10px] font-mono text-gray-400 ml-1">{a.admission_number}</span></div>
                    <div className="text-xs text-gray-500">{lead?.phone} · {lead?.course_interest||a.course?.name||'—'}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{formatDateTime(a.created_at)}</div>
                  </div>
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${sc.color}`}>{sc.label}</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-50">
                  {a.status==='pending'&&<><button disabled={acting===a.id} onClick={()=>updateStatus(a.id,'awaiting_forms')} className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition">Request Forms</button><button disabled={acting===a.id} onClick={()=>updateStatus(a.id,'awaiting_payment')} className="px-3 py-1.5 bg-orange-500 text-white rounded-xl text-xs font-semibold disabled:opacity-50 transition">Awaiting Payment</button></>}
                  {['awaiting_forms','awaiting_payment'].includes(a.status)&&<button disabled={acting===a.id} onClick={()=>updateStatus(a.id,'admitted')} className="px-3 py-1.5 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 disabled:opacity-50 transition">✓ Admit</button>}
                  {!['rejected','admitted'].includes(a.status)&&<button disabled={acting===a.id} onClick={()=>updateStatus(a.id,'rejected')} className="px-3 py-1.5 bg-red-50 text-red-600 rounded-xl text-xs font-semibold hover:bg-red-100 disabled:opacity-50 transition">Reject</button>}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-300 text-sm">No admissions in this category</div>}
        </div>
      )}
    </div>
  )
}
