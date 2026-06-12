'use client'
import { CONFIG } from '@/lib/config'
import { useState, useEffect } from 'react'

import type { Profile, Application } from '@/types'
import { toast } from 'sonner'
import { Copy, ExternalLink, TrendingUp } from 'lucide-react'

export default function MarketerLink() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState({ total: 0, paid: 0, converted: 0 })
  const [applications, setApplications] = useState<Application[]>([])

  useEffect(() => {
    async function load() {
      const s = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null)
      if (!s?.valid) return

      const params = new URLSearchParams({
        table: 'profiles', select: '*',
        filters: JSON.stringify([{ col: 'id', op: 'eq', val: s.userId }]),
        limit: '1',
      })
      const profRes = await fetch(`/api/data?${params}`).then(r => r.json())
      const p = profRes.data?.[0] || null
      setProfile(p)

      if (p) {
        const appParams = new URLSearchParams({
          table: 'applications', select: '*,course:course_id(name)',
          filters: JSON.stringify([{ col: 'marketer_id', op: 'eq', val: s.userId }]),
          orderBy: 'created_at', orderAsc: 'false', limit: '500',
        })
        const appRes = await fetch(`/api/data?${appParams}`).then(r => r.json())
        const apps: any[] = appRes.data || []
        setApplications(apps)
        setStats({
          total: apps.length,
          paid: apps.filter(a => a.payment_status === 'paid').length,
          converted: apps.filter(a => a.is_submitted).length,
        })
      }
    }
    load()
  }, [])

  const appUrl = profile?.marketer_code
    ? `${CONFIG.appUrl}/apply/${profile.marketer_code}`
    : null

  function copy() {
    if (!appUrl) return
    navigator.clipboard.writeText(appUrl)
    toast.success('Link copied!')
  }

  return (
    <div className="fade-in w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Application Link</h1>
        <p className="text-gray-500 text-sm mt-0.5">Share this unique link to track your referrals</p>
      </div>

      {/* Link card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Your unique application URL</p>
        {appUrl ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 font-mono break-all">
              {appUrl}
            </div>
            <button onClick={copy} className="flex-shrink-0 p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition">
              <Copy size={18} />
            </button>
            <a href={appUrl} target="_blank" className="flex-shrink-0 p-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">
              <ExternalLink size={18} />
            </a>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Your application link is being generated...</p>
        )}
        <p className="text-xs text-gray-400 mt-3">
          Share this link on WhatsApp, social media, or via email. All applications submitted through your link are tracked to you.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Applications', value: stats.total, color: 'text-blue-600' },
          { label: 'Paid', value: stats.paid, color: 'text-green-600' },
          { label: 'Submitted', value: stats.converted, color: 'text-purple-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Applications table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900">Applications via your link</h3>
        </div>
        {applications.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <TrendingUp size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No applications yet. Share your link!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Name','Email','Course','Payment','Date'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.map(a => (
                  <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{a.full_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{a.email}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{(a as any).course?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {a.payment_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{new Date(a.created_at).toLocaleDateString('en-GH')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
