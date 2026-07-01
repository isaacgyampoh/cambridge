import { createServiceClient } from '@/lib/supabase/server'

type Ctx = { userId: string; role: string; fullName?: string }

const FINANCE_ROLES = ['super_admin', 'project_manager', 'accountant']
const OVERSIGHT_ROLES = ['super_admin', 'project_manager']
const SUPER_ONLY = ['super_admin']

async function findStaffByName(sb: any, name: string) {
  const { data } = await sb.from('profiles').select('id, full_name, role')
    .ilike('full_name', `%${name.trim()}%`).eq('is_active', true).limit(5)
  return data || []
}

export const TOOLS: Record<string, {
  description: string
  parameters: Record<string, string>
  roles: string[] | 'all'
  run: (args: any, ctx: Ctx) => Promise<any>
}> = {

  count_leads: {
    description: "Count leads, optionally filtered by status (new, contacted, registered, etc.) and/or by the marketer who owns them. For 'converted'/'registered' use status='registered'.",
    parameters: { status: 'optional lead status', marketer_name: 'optional staff name to filter by' },
    roles: 'all',
    run: async (args, ctx) => {
      const sb = createServiceClient()
      let q = sb.from('leads').select('id, status, assigned_to')
      if (!OVERSIGHT_ROLES.includes(ctx.role)) {
        q = q.eq('assigned_to', ctx.userId)
      } else if (args.marketer_name) {
        const staff = await findStaffByName(sb, args.marketer_name)
        if (!staff.length) return { error: `No staff found matching "${args.marketer_name}".` }
        if (staff.length > 1) return { note: 'Multiple matches', matches: staff.map((s: any) => s.full_name) }
        q = q.eq('assigned_to', staff[0].id)
      }
      if (args.status) q = q.eq('status', args.status)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { count: (data || []).length, status: args.status || 'all', marketer: args.marketer_name || (OVERSIGHT_ROLES.includes(ctx.role) ? 'everyone' : 'you') }
    },
  },

  marketer_performance: {
    description: "Get a marketer's performance: how many leads assigned, how many converted/registered. Use when asked 'how many has X converted' or 'how is X doing'.",
    parameters: { marketer_name: 'the staff name' },
    roles: OVERSIGHT_ROLES,
    run: async (args, _ctx) => {
      const sb = createServiceClient()
      if (!args.marketer_name) return { error: 'Please tell me which marketer.' }
      const staff = await findStaffByName(sb, args.marketer_name)
      if (!staff.length) return { error: `No staff found matching "${args.marketer_name}".` }
      if (staff.length > 1) return { note: 'Multiple matches — be more specific', matches: staff.map((s: any) => s.full_name) }
      const m = staff[0]
      const { data: leads } = await sb.from('leads').select('status').eq('assigned_to', m.id)
      const total = (leads || []).length
      const registered = (leads || []).filter((l: any) => l.status === 'registered').length
      return { marketer: m.full_name, total_leads: total, converted: registered, conversion_rate: total ? `${Math.round(registered / total * 100)}%` : '0%' }
    },
  },

  outstanding_fees: {
    description: "Finance: who owes money and the total outstanding. Use for 'how many are owing', 'total amount owed', 'who hasn't paid'.",
    parameters: { limit: 'optional max names to list (default 15)' },
    roles: FINANCE_ROLES,
    run: async (args, _ctx) => {
      const sb = createServiceClient()
      const { data } = await sb.from('student_fees').select('student_name, total_fee, amount_paid').limit(1000)
      const owing = (data || [])
        .map((f: any) => ({ name: f.student_name, balance: Number(f.total_fee || 0) - Number(f.amount_paid || 0) }))
        .filter((f: any) => f.balance > 0.01)
        .sort((a: any, b: any) => b.balance - a.balance)
      const total = owing.reduce((s: number, f: any) => s + f.balance, 0)
      const limit = args.limit || 15
      return {
        people_owing: owing.length,
        total_outstanding: `GHS ${total.toFixed(2)}`,
        top_debtors: owing.slice(0, limit).map((f: any) => `${f.name}: GHS ${f.balance.toFixed(2)}`),
      }
    },
  },

  staff_attendance: {
    description: "When a staff member clocked in / came to work. Use for 'what time did X come to work', 'was X at work today'.",
    parameters: { staff_name: 'the staff name', date: "optional date YYYY-MM-DD, defaults to today" },
    roles: OVERSIGHT_ROLES,
    run: async (args, _ctx) => {
      const sb = createServiceClient()
      if (!args.staff_name) return { error: 'Which staff member?' }
      const staff = await findStaffByName(sb, args.staff_name)
      if (!staff.length) return { error: `No staff found matching "${args.staff_name}".` }
      if (staff.length > 1) return { note: 'Multiple matches', matches: staff.map((s: any) => s.full_name) }
      const m = staff[0]
      const day = args.date || new Date().toISOString().slice(0, 10)
      const { data } = await sb.from('staff_attendance').select('clock_in_at, clock_out_at, created_at')
        .eq('user_id', m.id).gte('created_at', `${day}T00:00:00`).lte('created_at', `${day}T23:59:59`)
        .order('created_at', { ascending: true }).limit(5)
      if (!data?.length) return { staff: m.full_name, date: day, result: 'No clock-in recorded for that day.' }
      const first = data[0]
      return { staff: m.full_name, date: day, clocked_in: first.clock_in_at || first.created_at, clocked_out: first.clock_out_at || 'not yet' }
    },
  },

  my_earnings: {
    description: "The asking user's own points and credited enrollments this year. Use for 'how many points do I have', 'how am I doing'.",
    roles: 'all',
    parameters: {},
    run: async (_args, ctx) => {
      const sb = createServiceClient()
      const year = new Date().getFullYear()
      const { data } = await sb.from('marketer_enrollments').select('points, registration_fee').eq('marketer_id', ctx.userId).eq('year', year).limit(2000)
      const totalPoints = (data || []).reduce((s: number, r: any) => s + Number(r.points || 0), 0)
      return { total_points: totalPoints, enrollments_credited: (data || []).length, year }
    },
  },

  registrations_summary: {
    description: "Overall registration/enrolment numbers across the centre (counts of registered students, optionally this week/month).",
    parameters: { period: "optional: 'week', 'month', or 'all' (default all)" },
    roles: OVERSIGHT_ROLES.concat(['accountant']),
    run: async (args, _ctx) => {
      const sb = createServiceClient()
      let q = sb.from('applications').select('id, created_at, payment_status')
      if (args.period === 'week') q = q.gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString())
      if (args.period === 'month') q = q.gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
      const { data } = await q.limit(5000)
      const all = data || []
      const paid = all.filter((a: any) => a.payment_status === 'paid' || a.payment_status === 'partial').length
      return { period: args.period || 'all', total_applications: all.length, registered_paid: paid }
    },
  },

  top_marketers: {
    description: "Leaderboard: the best-performing marketers by points/conversions, optionally this month. Use for 'who is my top marketer', 'best performers'.",
    parameters: { period: "optional 'month' or 'all' (default all)", limit: 'optional number (default 5)' },
    roles: OVERSIGHT_ROLES,
    run: async (args, _ctx) => {
      const sb = createServiceClient()
      const year = new Date().getFullYear()
      let q = sb.from('marketer_enrollments').select('marketer_id, points').eq('year', year)
      if (args.period === 'month') q = q.gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
      const { data: en } = await q.limit(5000)
      const byMarketer: Record<string, number> = {}
      for (const e of en || []) byMarketer[e.marketer_id] = (byMarketer[e.marketer_id] || 0) + Number(e.points || 0)
      const ids = Object.keys(byMarketer)
      if (!ids.length) return { result: 'No enrollments credited yet.' }
      const { data: staff } = await sb.from('profiles').select('id, full_name').in('id', ids)
      const nameOf: Record<string, string> = {}
      for (const s of staff || []) nameOf[s.id] = s.full_name
      const ranked = ids.map(id => ({ name: nameOf[id] || 'Unknown', points: byMarketer[id] }))
        .sort((a, b) => b.points - a.points).slice(0, args.limit || 5)
      return { period: args.period || 'all', leaderboard: ranked.map((r, i) => `${i + 1}. ${r.name} — ${r.points} points`) }
    },
  },

  cold_leads: {
    description: "Leads that have gone quiet / not been updated in a while and need follow-up. Use for 'which leads are going cold', 'leads needing attention'. Non-oversight staff see only their own.",
    parameters: { days: 'optional days since last update (default 5)' },
    roles: 'all',
    run: async (args, ctx) => {
      const sb = createServiceClient()
      const days = args.days || 5
      const cutoff = new Date(Date.now() - days * 864e5).toISOString()
      let q = sb.from('leads').select('full_name, status, updated_at, assigned_to')
        .lt('updated_at', cutoff).not('status', 'in', '(registered,lost,not_interested)')
      if (!OVERSIGHT_ROLES.includes(ctx.role)) q = q.eq('assigned_to', ctx.userId)
      const { data } = await q.order('updated_at', { ascending: true }).limit(30)
      const list = data || []
      return { days, count: list.length, leads: list.slice(0, 20).map((l: any) => `${l.full_name} (${l.status}, quiet since ${new Date(l.updated_at).toLocaleDateString()})`) }
    },
  },

  todays_signins: {
    description: "Who signed in to class today and how (online/in-person). Use for 'who signed in today', 'today's attendance'.",
    parameters: {},
    roles: OVERSIGHT_ROLES.concat(['trainer', 'receptionist']),
    run: async (_args, _ctx) => {
      const sb = createServiceClient()
      const day = new Date().toISOString().slice(0, 10)
      const { data } = await sb.from('class_signins').select('full_name, attendance_type, created_at')
        .gte('created_at', `${day}T00:00:00`).order('created_at', { ascending: false }).limit(100)
      const list = data || []
      const online = list.filter((s: any) => s.attendance_type === 'online').length
      return { date: day, total: list.length, online, in_person: list.length - online, names: list.slice(0, 25).map((s: any) => `${s.full_name} (${s.attendance_type})`) }
    },
  },

  revenue_summary: {
    description: "Money collected: total fees paid, optionally this week/month. Use for 'how much have we collected', 'revenue this month'.",
    parameters: { period: "optional 'week', 'month', or 'all' (default all)" },
    roles: FINANCE_ROLES,
    run: async (args, _ctx) => {
      const sb = createServiceClient()
      const { data } = await sb.from('student_fees').select('amount_paid, updated_at').limit(5000)
      let rows = data || []
      const total = rows.reduce((s: number, f: any) => s + Number(f.amount_paid || 0), 0)
      return { period: args.period || 'all', total_collected: `GHS ${total.toFixed(2)}`, records: rows.length }
    },
  },

  course_popularity: {
    description: "Which courses/programmes have the most interest or registrations. Use for 'which course is most popular', 'what are people signing up for'.",
    parameters: {},
    roles: OVERSIGHT_ROLES.concat(['accountant']),
    run: async (_args, _ctx) => {
      const sb = createServiceClient()
      const { data } = await sb.from('leads').select('course_interest').not('course_interest', 'is', null).limit(5000)
      const counts: Record<string, number> = {}
      for (const l of data || []) { const c = (l.course_interest || '').trim(); if (c) counts[c] = (counts[c] || 0) + 1 }
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
      if (!ranked.length) return { result: 'No course-interest data yet.' }
      return { by_interest: ranked.map(([c, n]) => `${c}: ${n} leads`) }
    },
  },

  admissions_status: {
    description: "Admissions pipeline: how many pending / awaiting payment / admitted. Use for 'do we have pending admissions', 'how many admissions', 'any new admissions'.",
    parameters: { status: "optional: 'pending', 'awaiting_payment', 'admitted' — omit for a full breakdown" },
    roles: OVERSIGHT_ROLES.concat(['admissions_officer', 'accountant']),
    run: async (args, _ctx) => {
      const sb = createServiceClient()
      const { data } = await sb.from('admissions').select('status, admission_number, created_at').limit(5000)
      const all = data || []
      if (args.status) {
        const n = all.filter((a: any) => a.status === args.status).length
        return { status: args.status, count: n }
      }
      const pending = all.filter((a: any) => a.status === 'pending').length
      const awaiting = all.filter((a: any) => a.status === 'awaiting_payment').length
      const admitted = all.filter((a: any) => a.status === 'admitted').length
      return { total: all.length, pending, awaiting_payment: awaiting, admitted }
    },
  },

  content_activity: {
    description: "What the content team has produced: content posts and brand-kit assets created, optionally this week. Use for 'have we made any brand kit this week', 'what content have we created', 'is the content team working'.",
    parameters: { period: "optional 'week' or 'all' (default all)", type: "optional 'posts' or 'brand'" },
    roles: SUPER_ONLY.concat(['project_manager', 'content_manager']),
    run: async (args, _ctx) => {
      const sb = createServiceClient()
      const since = args.period === 'week' ? new Date(Date.now() - 7 * 864e5).toISOString() : null
      let postsQ = sb.from('content_posts').select('title, status, created_at')
      let brandQ = sb.from('brand_assets').select('name, created_at')
      if (since) { postsQ = postsQ.gte('created_at', since); brandQ = brandQ.gte('created_at', since) }
      const [{ data: posts }, { data: brand }] = await Promise.all([postsQ.limit(500), brandQ.limit(500)])
      return {
        period: args.period || 'all',
        content_posts: (posts || []).length,
        brand_assets: (brand || []).length,
        note: (posts || []).length === 0 && (brand || []).length === 0
          ? 'The content team has not produced anything in this period.'
          : undefined,
      }
    },
  },

  pm_activity: {
    description: "Whether project managers have been active with the team — recent lead assignments, transfers, or oversight actions. Use for 'has the PM been in touch with marketers', 'is the PM working'.",
    parameters: {},
    roles: SUPER_ONLY,
    run: async (_args, _ctx) => {
      const sb = createServiceClient()
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
      const { count: assigned } = await sb.from('leads').select('id', { count: 'exact', head: true })
        .not('assigned_by', 'is', null).gte('assigned_at', weekAgo)
      let transfers = 0
      try {
        const { count } = await sb.from('lead_transfer_requests').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo)
        transfers = count || 0
      } catch {}
      return { leads_assigned_this_week: assigned || 0, transfer_requests_this_week: transfers, note: (assigned || 0) === 0 ? 'No lead assignments by PMs in the last 7 days.' : undefined }
    },
  },
}

export function toolsForRole(role: string) {
  return Object.entries(TOOLS)
    .filter(([_, t]) => t.roles === 'all' || (Array.isArray(t.roles) && t.roles.includes(role)))
    .map(([name, t]) => ({ name, description: t.description, parameters: t.parameters }))
}

export async function runTool(name: string, args: any, ctx: Ctx) {
  const tool = TOOLS[name]
  if (!tool) return { error: `Unknown tool: ${name}` }
  const allowed = tool.roles === 'all' || (Array.isArray(tool.roles) && tool.roles.includes(ctx.role))
  if (!allowed) return { error: "You don't have access to that information." }
  try { return await tool.run(args || {}, ctx) }
  catch (e: any) { return { error: e.message } }
}
