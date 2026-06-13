'use client'
import { useState, useEffect } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { PageHeader, Card, StatCard, SectionLabel, Spinner } from '@/components/ui'
import { formatGHS } from '@/lib/utils'
import { TrendingUp, DollarSign, Target, Users } from 'lucide-react'

const ACCENT = '#1c4a45'
const SOURCE_COLORS = ['#1c4a45', '#9a7b4f', '#3d6b64', '#b89968', '#5a8a82', '#6b7280']

export default function InsightsPage() {
  const [data, setData] = useState<any>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics?days=${days}`).then(r => r.json()).then(d => { setData(d); setLoading(false) })
  }, [days])

  const funnelStages = data ? [
    { label: 'New', value: data.funnel.new, color: '#9a7b4f' },
    { label: 'Contacted', value: data.funnel.contacted, color: '#7a8b6f' },
    { label: 'Interested', value: data.funnel.interested, color: '#5a8a82' },
    { label: 'Ready to join', value: data.funnel.ready, color: '#3d6b64' },
    { label: 'Registered', value: data.funnel.registered, color: '#1c4a45' },
  ] : []
  const maxFunnel = Math.max(1, ...funnelStages.map(s => s.value))

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Analytics"
        title="Insights"
        description="How the centre is performing — leads, conversion and revenue over time."
        actions={
          <div className="flex gap-1 bg-[var(--line-soft)] rounded-lg p-1">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition ${days === d ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}>
                {d}d
              </button>
            ))}
          </div>
        }
      />

      {loading || !data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Leads" value={data.totals.leads} sub={`last ${days} days`} icon={<TrendingUp size={18} />} />
            <StatCard label="Conversion rate" value={`${data.totals.convRate}%`} sub={`${data.totals.conversions} converted`} icon={<Target size={18} />} accent />
            <StatCard label="Revenue" value={formatGHS(data.totals.revenue)} sub="collected" icon={<DollarSign size={18} />} />
            <StatCard label="Active students" value={data.totals.students} sub={`${data.totals.activeStaff} staff`} icon={<Users size={18} />} />
          </div>

          {/* Trend chart */}
          <Card className="p-5 mb-6">
            <SectionLabel>Leads & revenue trend</SectionLabel>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={ACCENT} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={36} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e8e6', fontSize: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}
                  labelFormatter={(d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })} />
                <Area type="monotone" dataKey="leads" stroke={ACCENT} strokeWidth={2} fill="url(#gLeads)" name="Leads" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Funnel */}
            <Card className="p-5">
              <SectionLabel>Conversion funnel</SectionLabel>
              <div className="space-y-3 mt-2">
                {funnelStages.map(s => (
                  <div key={s.label}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-[var(--ink-soft)]">{s.label}</span>
                      <span className="font-semibold text-[var(--ink)]">{s.value}</span>
                    </div>
                    <div className="h-2.5 bg-[var(--line-soft)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(s.value / maxFunnel) * 100}%`, backgroundColor: s.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Source pie */}
            <Card className="p-5">
              <SectionLabel>Lead sources</SectionLabel>
              {data.bySource.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-sm text-[var(--ink-faint)]">No lead data yet</div>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="55%" height={200}>
                    <PieChart>
                      <Pie data={data.bySource} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                        {data.bySource.map((_: any, i: number) => <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e8e6', fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {data.bySource.map((s: any, i: number) => (
                      <div key={s.name} className="flex items-center gap-2 text-sm">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                        <span className="text-[var(--ink-soft)] capitalize flex-1">{s.name}</span>
                        <span className="font-semibold text-[var(--ink)]">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Revenue bars */}
          <Card className="p-5">
            <SectionLabel>Daily revenue</SectionLabel>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => v >= 1000 ? `${v / 1000}k` : v} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e8e6', fontSize: 12 }}
                  formatter={(v: any) => [formatGHS(Number(v)), 'Revenue']}
                  labelFormatter={(d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })} />
                <Bar dataKey="revenue" fill={ACCENT} radius={[4, 4, 0, 0]} name="Revenue" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </div>
  )
}
