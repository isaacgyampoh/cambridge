'use client'
import { useState, useEffect } from 'react'
import { displayPhone } from '@/lib/ui/contact'
import { PageHeader, Card, StatCard, Spinner, Button } from '@/components/ui'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { toast } from 'sonner'

type ReferralCode = {
  id: string
  referrer_name: string
  code: string
  referrals_count?: number
  enrolled?: number
  referrer_phone?: string | null
  referrer_email?: string | null
}

export default function ReferralsAdmin() {
  const [data, setData] = useState<any>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/referrals/list').then(r => r.json()).then(setData).catch(() => setData({ codes: [] }))
  }, [])

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/refer` : '/refer'
  function copyShare() { navigator.clipboard.writeText(shareUrl); setCopied(true); toast.success('Referral page link copied'); setTimeout(() => setCopied(false), 2000) }

  if (!data) return <div className="py-20"><Spinner /></div>

  const referrerColumns: Column<ReferralCode>[] = [
    { key: 'referrer', header: 'Referrer', primary: true, render: c => c.referrer_name },
    {
      key: 'code', header: 'Code', secondary: true,
      render: c => <span className="font-mono text-[13px]">{c.code}</span>,
    },
    { key: 'referred', header: 'Referred', numeric: true, render: c => c.referrals_count || 0 },
    {
      key: 'enrolled', header: 'Enrolled', numeric: true,
      render: c => <span className="font-semibold text-[var(--ok)]">{c.enrolled || 0}</span>,
    },
    {
      key: 'contact', header: 'Contact',
      render: c => displayPhone(c.referrer_phone) || c.referrer_email || '—',
    },
  ]

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
        <h3 className="font-display text-[15px] font-semibold text-[var(--ink)] mb-4">Top referrers</h3>
        <DataTable<ReferralCode>
          caption="Top referrers"
          rows={data.codes || []}
          rowKey={c => c.id}
          columns={referrerColumns}
          emptyTitle="No referrals yet"
          emptyMessage="Share the referral page link above with your students and leads so they can start referring friends."
        />
      </Card>
    </div>
  )
}
