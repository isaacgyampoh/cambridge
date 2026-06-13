'use client'
import { useState, useEffect } from 'react'
import { MapPin, CheckCircle2, LogIn, LogOut, AlertTriangle, Clock } from 'lucide-react'
import { Card, Button, Badge, Spinner } from '@/components/ui'
import { toast } from 'sonner'

export default function ClockInPage() {
  const [me, setMe] = useState<any>(null)
  const [today, setToday] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'ready' | 'denied'>('idle')

  async function load() {
    const s = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null)
    if (!s?.valid) return
    setMe(s)
    const params = new URLSearchParams({
      table: 'staff_attendance', select: '*',
      filters: JSON.stringify([
        { col: 'staff_id', op: 'eq', val: s.userId },
        { col: 'date', op: 'eq', val: new Date().toISOString().slice(0, 10) },
      ]),
      limit: '1',
    })
    const r = await fetch(`/api/data?${params}`).then(r => r.json())
    setToday(r.data?.[0] || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function getLocation(): Promise<{ lat: number; lng: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Your device does not support location.'))
      setGeoState('locating')
      navigator.geolocation.getCurrentPosition(
        pos => { setGeoState('ready'); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }) },
        err => { setGeoState('denied'); reject(new Error(err.code === 1 ? 'Location permission denied. Please allow location access in your browser to sign in.' : 'Could not get your location. Try again.')) },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      )
    })
  }

  async function clock(action: 'in' | 'out') {
    setBusy(true)
    try {
      const { lat, lng } = await getLocation()
      const res = await fetch('/api/staff-attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, lat, lng }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Could not record sign-in'); return }
      toast.success(action === 'in'
        ? `Signed in at ${d.office}${d.status === 'late' ? ' (late)' : ''}`
        : `Signed out from ${d.office}`)
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />

  const clockedIn = !!today?.clock_in_at
  const clockedOut = !!today?.clock_out_at
  const fmt = (t: string) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="fade-in max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-2">Staff attendance</div>
        <h1 className="font-display text-[26px] font-semibold text-[var(--ink)]">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h1>
        <p className="text-[var(--ink-soft)] text-sm mt-1">Sign in when you arrive at the office.</p>
      </div>

      <Card className="p-6">
        {/* Status */}
        <div className="flex items-center justify-between mb-5 pb-5 border-b border-[var(--line-soft)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] font-semibold">
              {me?.fullName?.charAt(0)}
            </div>
            <div>
              <div className="font-medium text-[var(--ink)]">{me?.fullName}</div>
              <div className="text-xs text-[var(--ink-faint)] capitalize">{me?.role?.replace(/_/g, ' ')}</div>
            </div>
          </div>
          {clockedOut ? <Badge tone="muted">Day complete</Badge>
            : clockedIn ? <Badge tone="success">On site</Badge>
            : <Badge tone="neutral">Not signed in</Badge>}
        </div>

        {/* Times */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-[var(--line-soft)] rounded-lg p-3 text-center">
            <div className="text-[11px] text-[var(--ink-faint)] uppercase tracking-wide mb-1">Clock in</div>
            <div className="font-display text-xl font-semibold text-[var(--ink)]">{today?.clock_in_at ? fmt(today.clock_in_at) : '—'}</div>
            {today?.status === 'late' && <div className="text-[10px] text-amber-600 font-medium mt-0.5">Late</div>}
          </div>
          <div className="bg-[var(--line-soft)] rounded-lg p-3 text-center">
            <div className="text-[11px] text-[var(--ink-faint)] uppercase tracking-wide mb-1">Clock out</div>
            <div className="font-display text-xl font-semibold text-[var(--ink)]">{today?.clock_out_at ? fmt(today.clock_out_at) : '—'}</div>
          </div>
        </div>

        {/* Action */}
        {!clockedIn ? (
          <Button onClick={() => clock('in')} disabled={busy} className="w-full h-12" icon={<LogIn size={16} />}>
            {busy ? (geoState === 'locating' ? 'Checking your location…' : 'Signing in…') : 'Sign in'}
          </Button>
        ) : !clockedOut ? (
          <Button onClick={() => clock('out')} disabled={busy} variant="secondary" className="w-full h-12" icon={<LogOut size={16} />}>
            {busy ? 'Signing out…' : 'Sign out'}
          </Button>
        ) : (
          <div className="flex items-center justify-center gap-2 text-[var(--accent)] py-3">
            <CheckCircle2 size={18} />
            <span className="text-sm font-medium">You have completed today</span>
          </div>
        )}

        {/* Location note */}
        <div className="flex items-start gap-2 mt-5 text-xs text-[var(--ink-faint)]">
          <MapPin size={13} className="flex-shrink-0 mt-0.5" />
          <span>Your location is checked at sign-in. You must be at the office for it to be accepted — this prevents remote sign-ins.</span>
        </div>
        {geoState === 'denied' && (
          <div className="flex items-start gap-2 mt-3 text-xs text-red-600 bg-red-50 rounded-lg p-3">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>Location access is blocked. Enable it in your browser settings to sign in.</span>
          </div>
        )}
      </Card>
    </div>
  )
}
