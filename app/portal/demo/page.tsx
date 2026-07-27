'use client'
import { useState } from 'react'
import PortalView from '../PortalView'

/**
 * PUBLIC DEMO — no login, no WhatsApp, no database. Opens instantly so the
 * portal can be shown to the team and to students. Toggle between the three
 * states a real student moves through.
 */
const base = {
  student: { name: 'Kwame Boateng', phone: '0241234567' },
  course: 'Projects Management Professional (PMP)',
  batch: { id: 'demo', name: 'PMP Cohort — March', schedule: 'Sat & Sun, 9am–1pm', type: 'online' },
  enrollmentId: 'demo',
  payments: [
    { amount: 200, method: 'paystack', receipt_number: 'RCP-10231', created_at: new Date(Date.now() - 6 * 864e5).toISOString() },
  ],
}

const STATES: Record<string, any> = {
  owing: {
    ...base,
    fee: { total: 3950, paid: 200, balance: 3750, status: 'partial' },
    session: { sessionNumber: 2, freeSessions: 1, requiredTotal: 500, minTopUp: 300, canJoin: false, signedInToday: false, cohortEnded: false, zoomLink: null },
    materials: {
      unlocked: [{ name: 'PMP Module 1 — Foundations.pdf', url: '#' }],
      locked: [
        { name: 'PMP Module 2 — Planning.pdf', unlockAt: 500 },
        { name: 'PMP Module 3 — Execution.pdf', unlockAt: 1500 },
        { name: 'PMP Exam Practice Questions.pdf', unlockAt: 2500 },
      ],
    },
  },
  paid: {
    ...base,
    fee: { total: 3950, paid: 2600, balance: 1350, status: 'partial' },
    session: { sessionNumber: 4, freeSessions: 1, requiredTotal: 1500, minTopUp: 0, canJoin: true, signedInToday: false, cohortEnded: false, zoomLink: 'https://zoom.us/j/demo' },
    payments: [
      { amount: 1200, method: 'momo', receipt_number: 'RCP-10488', created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
      { amount: 1200, method: 'momo', receipt_number: 'RCP-10402', created_at: new Date(Date.now() - 9 * 864e5).toISOString() },
      { amount: 200, method: 'paystack', receipt_number: 'RCP-10231', created_at: new Date(Date.now() - 20 * 864e5).toISOString() },
    ],
    materials: {
      unlocked: [
        { name: 'PMP Module 1 — Foundations.pdf', url: '#' },
        { name: 'PMP Module 2 — Planning.pdf', url: '#' },
        { name: 'PMP Module 3 — Execution.pdf', url: '#' },
      ],
      locked: [{ name: 'PMP Exam Practice Questions.pdf', unlockAt: 3950 }],
    },
  },
  ended: {
    ...base,
    fee: { total: 3950, paid: 3950, balance: 0, status: 'paid' },
    session: { sessionNumber: 9, freeSessions: 1, requiredTotal: 3950, minTopUp: 0, canJoin: false, signedInToday: false, cohortEnded: true, endDate: new Date(Date.now() - 3 * 864e5).toISOString(), zoomLink: null },
    materials: {
      unlocked: [
        { name: 'PMP Module 1 — Foundations.pdf', url: '#' },
        { name: 'PMP Module 2 — Planning.pdf', url: '#' },
        { name: 'PMP Module 3 — Execution.pdf', url: '#' },
        { name: 'PMP Exam Practice Questions.pdf', url: '#' },
      ],
      locked: [],
    },
  },
}

const TABS = [
  { k: 'owing', label: 'Owing for next class' },
  { k: 'paid', label: 'Paid up — can join' },
  { k: 'ended', label: 'Cohort finished' },
]

export default function PortalDemo() {
  const [state, setState] = useState('owing')
  return (
    <div>
      <div style={{ background: '#1a2230', color: '#fff', padding: '10px 12px', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 7, textAlign: 'center' }}>
          Demo — sample student, nothing is saved. Switch between what a student sees:
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button key={t.k} onClick={() => setState(t.k)}
              style={{
                border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: state === t.k ? '#1a7a85' : 'rgba(255,255,255,.12)', color: '#fff',
              }}>{t.label}</button>
          ))}
        </div>
      </div>
      <PortalView demo demoData={STATES[state]} />
    </div>
  )
}
