'use client'

import {
  LayoutDashboard, Users, UserCheck, DollarSign, BookOpen, GraduationCap,
  TrendingUp, ClipboardList, Settings, Radio, CalendarCheck, FolderOpen,
  BarChart3, Sparkles, MessageSquare, Trophy, Link2, Upload, Send,
} from 'lucide-react'
import type { IconName } from '@/lib/nav/model'

/**
 * Icon names, bound to components.
 *
 * lib/nav/model.ts names its icons as strings so the navigation model stays
 * pure and testable without a DOM. This is the only place that turns those
 * names into React components, so the shell and the staff permission screen
 * cannot show different icons for the same destination.
 */
export const NAV_ICONS: Record<IconName, React.ComponentType<{ size?: number; className?: string }>> = {
  home: LayoutDashboard, leads: TrendingUp, admissions: UserCheck,
  finance: DollarSign, academics: BookOpen, attendance: CalendarCheck,
  documents: FolderOpen, staff: Users, messages: MessageSquare,
  broadcast: Radio, insights: BarChart3, reports: ClipboardList,
  settings: Settings, clock: CalendarCheck, links: Link2, flyers: Sparkles,
  prep: ClipboardList, alumni: GraduationCap, social: Sparkles, ai: Sparkles,
  trophy: Trophy, workforce: Users, import: Upload, sms: Send,
}
