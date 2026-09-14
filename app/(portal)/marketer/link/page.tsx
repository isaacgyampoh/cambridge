'use client'
import { CONFIG } from '@/lib/config'
import { readableStatus } from '@/lib/ui/status'
import { useState, useEffect } from 'react'

import type { Profile, Application } from '@/types'
import { toast } from 'sonner'
import SharedLinks from '@/components/shared/SharedLinks'
import { ShareLink } from '@/components/shared/ShareLink'
import { PageHeader, Card, Button, LoadingState } from '@/components/ui'
import { BRAND } from '@/lib/brand'
import { DataTable, type Column } from '@/components/ui/DataTable'

export default function MarketerLink() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState({ total: 0, paid: 0, converted: 0 })
  const [sessionJoins, setSessionJoins] = useState<{ total: number; sessions: { title: string; count: number }[] }>({ total: 0, sessions: [] })
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  async function generateLink() {
    setGenerating(true)
    try {
      const ec = await fetch('/api/marketer/ensure-code', { method: 'POST' }).then(r => r.json())
      if (ec?.marketer_code) {
        // Build/merge the profile so the link renders even if profile was null
        setProfile(p => ({ ...(p || {}), marketer_code: ec.marketer_code } as Profile))
        toast.success('Your link is ready')
      } else {
        toast.error(ec?.error || 'Could not generate link')
      }
    } catch {
      toast.error('Could not generate link. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    async function load() {
      const s = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null)
      if (!s?.valid) { setLoading(false); return }

      fetch('/api/info-sessions/my-joins').then(r => r.json()).then(setSessionJoins).catch(() => {})

      const params = new URLSearchParams({
        table: 'profiles', select: '*',
        filters: JSON.stringify([{ col: 'id', op: 'eq', val: s.userId }]),
        limit: '1',
      })
      const profRes = await fetch(`/api/data?${params}`).then(r => r.json())
      let p = profRes.data?.[0] || null

      // If the marketer has no registration link code yet, generate one
      if (p && !p.marketer_code) {
        try {
          const ec = await fetch('/api/marketer/ensure-code', { method: 'POST' }).then(r => r.ok ? r.json() : null)
          if (ec?.marketer_code) p = { ...p, marketer_code: ec.marketer_code }
        } catch {}
      }
      setProfile(p)
      setLoading(false)

      if (p) {
        const appParams = new URLSearchParams({
          table: 'applications', select: '*,course:course_id(name)',
          filters: JSON.stringify([{ col: 'marketer_id', op: 'eq', val: s.userId }]),
          orderBy: 'created_at', orderAsc: 'false', limit: '500',
        })
        const appRes = await fetch(`/api/data?${appParams}`).then(r => r.json())
        const apps: Application[] = appRes.data || []
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

  /*
   * The permanent marketing link.
   *
   * Same identifier as the other two — marketer_code — so all three name the
   * same person and nothing new had to be issued. What makes this one
   * different is that it does not point at a form: it shows whatever the
   * centre is currently running, decided when the page is opened. It can go
   * on a QR code, a printed card or an Instagram bio and still be correct
   * next term.
   */
  const marketingUrl = profile?.marketer_code
    ? `${CONFIG.appUrl}/m/${profile.marketer_code}`
    : ''

  const applicationColumns: Column<Application>[] = [
    { key: 'name', header: 'Name', primary: true, render: a => a.full_name },
    { key: 'email', header: 'Email', secondary: true, render: a => a.email || '—' },
    {
      key: 'course', header: 'Course',
      render: a => (a as Application & { course?: { name?: string } }).course?.name || '—',
    },
    {
      key: 'payment', header: 'Payment',
      render: a => (
        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full
          ${a.payment_status === 'paid'
            ? 'bg-[var(--ok-soft)] text-[var(--ok)]'
            : 'bg-[var(--warn-soft)] text-[var(--warn)]'}`}>
          {readableStatus(a.payment_status)}
        </span>
      ),
    },
    {
      key: 'date', header: 'Date',
      render: a => (
        <span className="text-[var(--ink-faint)] text-[12px]">
          {new Date(a.created_at).toLocaleDateString('en-GH')}
        </span>
      ),
    },
  ]

  const referUrl = profile?.marketer_code
    ? `${CONFIG.appUrl}/refer?m=${profile.marketer_code}`
    : ''

  return (
    <div className="fade-in w-full max-w-3xl">
      {/*
        ── ORDER ────────────────────────────────────────────────────────────
        The person's OWN links come first.

        They used to sit below the office's shared-links noticeboard and an
        info-session panel, so the thing this screen exists for — copy my link
        and send it to somebody — was two scrolls down. Everything that
        REPORTS on the links now follows them.
      */}
      <PageHeader
        eyebrow="My work"
        title="My marketing links"
        description="Share these with people who want to join Cambridge. Anyone who applies through them becomes your lead."
      />

      {appUrl ? (
        <div className="space-y-3.5 mb-8">
          {marketingUrl && (
            <ShareLink
              url={marketingUrl}
              label="Your marketing link"
              hint="Shows whatever we are currently running — the programme, the start date and the fee. It never needs replacing, so put it on a flyer, a QR code or your status."
              shareText={`Professional training at ${BRAND.name}:`}
            />
          )}

          <ShareLink
            url={appUrl}
            label="Your registration link"
            hint="Goes straight to the application and payment form. Use it with somebody who is ready to register."
            shareText={`Register for ${BRAND.name}:`}
          />

          {referUrl && (
            <ShareLink
              url={referUrl}
              label="Your referral link"
              hint="Softer — they leave their details and become your lead, and the assistant follows up on WhatsApp. Post it on a status or a flyer."
              shareText={`Interested in professional training with ${BRAND.name}?`}
            />
          )}

          <p className="t-meta px-1">
            Everything submitted through either link is credited to you.
          </p>
        </div>
      ) : loading ? (
        <div className="mb-8"><LoadingState message="Finding your link…" /></div>
      ) : (
        <Card className="p-5 mb-8">
          <p className="text-[14px] text-[var(--ink)] font-medium">You do not have a link yet</p>
          <p className="t-sub mt-1 mb-4">
            Generate one and it is yours permanently — the same link, every time.
          </p>
          <Button onClick={generateLink} disabled={generating}>
            {generating ? 'Generating…' : 'Generate my link'}
          </Button>
        </Card>
      )}

      {/* Info-session joins through my link */}
      {sessionJoins.total > 0 && (
        <section className="mb-8">
          <h2 className="t-overline mb-3">Info sessions</h2>
          <Card className="p-5">
            <p className="text-[14px] text-[var(--ink)]">
              <span className="numeric font-semibold">{sessionJoins.total}</span>
              {' '}{sessionJoins.total === 1 ? 'person has' : 'people have'} joined an info
              session through your link.
            </p>
            {sessionJoins.sessions.length > 0 && (
              <dl className="mt-3 space-y-1.5">
                {sessionJoins.sessions.map((x: { title: string; count: number }, i: number) => (
                  <div key={i} className="flex justify-between gap-3 text-[13px]">
                    <dt className="text-[var(--ink-soft)] truncate">{x.title}</dt>
                    <dd className="numeric font-medium text-[var(--ink)] flex-shrink-0">{x.count}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </section>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Applications', value: stats.total },
          { label: 'Paid', value: stats.paid },
          { label: 'Submitted', value: stats.converted },
        ].map(s => (
          <div key={s.label} className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
            <div className="text-[13px] font-medium text-[var(--ink-faint)]">{s.label}</div>
            <div className="font-display text-[24px] font-semibold text-[var(--ink)] mt-2 leading-none">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Applications table */}
      <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--line)]">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Registrations via your link</h3>
        </div>
        <DataTable<Application>
          caption="Registrations via your link"
          rows={applications}
          rowKey={a => a.id}
          columns={applicationColumns}
          emptyTitle="No registrations yet"
          emptyMessage="Share your link with a ready lead and their registrations appear here."
        />
      </div>

      {/* The office's noticeboard — other people's links, not yours. */}
      <section className="mt-8">
        <h2 className="t-overline mb-3">Shared by the office</h2>
        <SharedLinks />
      </section>
    </div>
  )
}
