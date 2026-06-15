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
  facebook: 'bg-blue-100 text-blue-700',
  google: 'bg-red-100 text-red-700',
  linkedin: 'bg-blue-900/20 text-blue-800',
  website: 'bg-purple-100 text-purple-700',
  referral: 'bg-green-100 text-green-700',
  manual: 'bg-gray-100 text-gray-700',
}

export const STATUS_COLORS: Record<string, string> = {
  new: 'bg-yellow-100 text-yellow-800',
  contacted: 'bg-blue-100 text-blue-700',
  interested: 'bg-indigo-100 text-indigo-700',
  follow_up: 'bg-orange-100 text-orange-700',
  next_session: 'bg-amber-100 text-amber-700',
  zuku: 'bg-red-100 text-red-600',
  defiled: 'bg-purple-100 text-purple-700',
  done: 'bg-emerald-100 text-emerald-700',
  ready_to_join: 'bg-green-100 text-green-700',
  registered: 'bg-emerald-100 text-emerald-700',
  not_interested: 'bg-red-100 text-red-600',
  lost: 'bg-gray-100 text-gray-600',
}

export const STATUS_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', interested: 'Interested',
  follow_up: 'Follow Up', next_session: 'Next Session', zuku: 'Zuku',
  defiled: 'Defiled', done: 'Done', ready_to_join: 'Ready to Join',
  registered: 'Registered', not_interested: 'Not Interested', lost: 'Lost',
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  project_manager: 'Project Manager',
  marketing_officer: 'Marketing Officer',
  admissions_officer: 'Admissions Officer',
  accountant: 'Accountant',
  receptionist: 'Receptionist',
  trainer: 'Trainer',
  student: 'Student',
}

export const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  project_manager: 'bg-blue-100 text-blue-700',
  marketing_officer: 'bg-green-100 text-green-700',
  admissions_officer: 'bg-indigo-100 text-indigo-700',
  accountant: 'bg-yellow-100 text-yellow-700',
  receptionist: 'bg-pink-100 text-pink-700',
  trainer: 'bg-orange-100 text-orange-700',
  student: 'bg-gray-100 text-gray-700',
}
