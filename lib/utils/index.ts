import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatGHS(amount: number) {
  return `GHS ${Number(amount).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(date: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GH', opts || { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(date: string | null | undefined) {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-GH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatPhone(phone: string | null | undefined) {
  if (!phone) return '—'
  const p = phone.replace(/^233/, '0')
  return p.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')
}

export function initials(name: string) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

export function daysUntil(date: string) {
  const diff = new Date(date).getTime() - new Date().getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export const SOURCE_COLORS: Record<string, string> = {
  facebook: 'bg-[var(--info-soft)] text-[var(--info)]',
  google: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  linkedin: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  website: 'bg-[var(--gold-soft)] text-[var(--gold)]',
  referral: 'bg-[var(--ok-soft)] text-[var(--ok)]',
  manual: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
}

export const STATUS_COLORS: Record<string, string> = {
  new: 'bg-[var(--warn-soft)] text-[var(--warn)]',
  contacted: 'bg-[var(--info-soft)] text-[var(--info)]',
  interested: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  follow_up: 'bg-[var(--warn-soft)] text-[var(--warn)]',
  next_session: 'bg-[var(--gold-soft)] text-[var(--gold)]',
  zuku: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  defiled: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
  conflicts: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  deferred: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
  done: 'bg-[var(--ok-soft)] text-[var(--ok)]',
  ready_to_join: 'bg-[var(--ok-soft)] text-[var(--ok)]',
  registered: 'bg-[var(--ok-soft)] text-[var(--ok)]',
  not_interested: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  lost: 'bg-[var(--line-soft)] text-[var(--ink-faint)]',
}

export const STATUS_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', interested: 'Interested',
  follow_up: 'Follow Up', next_session: 'Next Session', zuku: 'Zuku',
  defiled: 'Defiled', conflicts: 'Conflicts', deferred: 'Deferred', done: 'Done', ready_to_join: 'Ready to Join',
  registered: 'Registered', not_interested: 'Not Interested', lost: 'Lost',
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  project_manager: 'Project Manager',
  marketing_officer: 'Marketing Officer',
  content_manager: 'Content Manager',
  admissions_officer: 'Admissions Officer',
  accountant: 'Accountant',
  receptionist: 'Receptionist',
  trainer: 'Trainer',
  student: 'Student',
  exam_coordinator: 'Exam Prep Coordinator',
}

export const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-[var(--ink)] text-white',
  project_manager: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  marketing_officer: 'bg-[var(--ok-soft)] text-[var(--ok)]',
  content_manager: 'bg-[var(--gold-soft)] text-[var(--gold)]',
  admissions_officer: 'bg-[var(--info-soft)] text-[var(--info)]',
  accountant: 'bg-[var(--warn-soft)] text-[var(--warn)]',
  receptionist: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
  trainer: 'bg-[var(--gold-soft)] text-[var(--gold)]',
  student: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
}
