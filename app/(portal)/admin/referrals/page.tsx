'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, StatCard, Spinner, EmptyState, Button } from '@/components/ui'
import { toast } from 'sonner'

export default function ReferralsAdmin() {
  const [data, setData] = useState<any>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/referrals/list').then(r => r.json()).then(setData).catch(() => setData({ codes: [] }))
  }, [])

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/refer` : '/refer'
  function copyShare() { navigator.clipboard.writeText(shareUrl); setCopied(true); toast.success('Referral page link copied'); setTimeout(() => setCopied(false), 2000) }

  if (!data) return <div className="py-20"><Spinner /></div>

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Growth" title="Referrals"
        description="Your students and leads refer friends. When a referred friend enrolls, the referrer earns a reward."
        actions={<Button onClick={copyShare}>{copied ? 'Copied!' : 'Copy referral page link'}</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Referrers" value={data.totalReferrers ?? 0} sub="people sharing" />
        <StatCard label="Referred leads" value={data.totalReferred ?? 0} sub="brought in" accent />
        <StatCard label="Enrolled" value={data.totalEnrolled ?? 0} sub="from referrals" />
        <StatCard label="Conversion" value={`${data.totalReferred ? Math.round((data.totalEnrolled / data.totalReferred) * 100) : 0}%`} sub="referred → enrolled" />
      </div>

      <Card className="p-6">
        <h3 className="font-display text-[16px] font-semibold text-[var(--ink)] mb-4">Top referrers</h3>
        {(!data.codes || data.codes.length === 0) ? (
          <EmptyState title="No referrals yet" description="Share the referral page link (button above) with your students and leads so they can start referring friends." />
        ) : (
          <div className="overflow-x-auto">
            <table className="rtc w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] text-[var(--ink-faint)] border-b border-[var(--line)]">
                  <th className="py-2.5 font-medium">Referrer</th>
                  <th className="py-2.5 font-medium">Code</th>
                  <th className="py-2.5 font-medium text-center">Referred</th>
                  <th className="py-2.5 font-medium text-center">Enrolled</th>
                  <th className="py-2.5 font-medium">Contact</th>
                </tr>
              </thead>
              <tbody>
                {data.codes.map((c: any) => (
                  <tr key={c.id} className="border-b border-[var(--line-soft)] last:border-0">
                    <td data-label="Referrer" className="py-3 font-medium text-[var(--ink)]">{c.referrer_name}</td>
                    <td data-label="Code" className="py-3 text-[var(--ink-soft)]">{c.code}</td>
                    <td data-label="Referred" className="py-3 text-center text-[var(--ink)]">{c.referrals_count || 0}</td>
                    <td data-label="Enrolled" className="py-3 text-center font-semibold text-[var(--ok)]">{c.enrolled || 0}</td>
                    <td data-label="Contact" className="py-3 text-[var(--ink-soft)]">{c.referrer_phone || c.referrer_email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
