import { createServiceClient } from '@/lib/supabase/server'

type Ctx = { userId: string; role: string; fullName?: string }

const FINANCE_ROLES = ['super_admin', 'project_manager', 'accountant']
const OVERSIGHT_ROLES = ['super_admin', 'project_manager']

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
