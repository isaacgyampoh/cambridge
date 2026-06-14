import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPIN } from '@/lib/auth/pin'
import { CONFIG } from '@/lib/config'

export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url)
 if (searchParams.get('secret') !== CONFIG.setupSecret) {
 return NextResponse.json({ error: 'Invalid setup secret' }, { status: 401 })
 }

 const sb = createServiceClient()
 const pinHash = hashPIN('1024')

 // Step 1: Create Supabase Auth user
 let userId: string | null = null

 const { data: authData, error: authErr } = await sb.auth.admin.createUser({
 email: CONFIG.superAdminEmail,
 password: CONFIG.superAdminPassword,
 email_confirm: true,
 })

 if (authErr?.message?.includes('already')) {
 const { data: users } = await sb.auth.admin.listUsers()
 userId = users?.users?.find((u: any) => u.email === CONFIG.superAdminEmail)?.id || null
 } else if (authErr) {
 return NextResponse.json({ error: `Auth error: ${authErr.message}` }, { status: 500 })
 } else {
 userId = authData?.user?.id || null
 }

 if (!userId) {
 return NextResponse.json({
 error: 'Could not get user ID. Run FULL-SCHEMA.sql in Supabase SQL Editor first.',
 hint: 'Go to supabase.com → your project → SQL Editor → paste FULL-SCHEMA.sql → Run',
 }, { status: 500 })
 }

 // Step 2: Check if profile already exists
 const { data: existing } = await sb.from('profiles')
 .select('id, phone')
 .eq('id', userId)
 .maybeSingle()

 if (existing) {
 // Already exists — just reset PIN
 await sb.from('profiles').update({
 pin_hash: pinHash,
 must_change_pin: true,
 is_active: true,
 locked_until: null,
 login_attempts: 0,
 }).eq('id', userId)

 return NextResponse.json({
 success: true,
 message: ' Super admin PIN reset to 1024',
 login: {
 phone: existing.phone?.replace(/^233/, '0') || '0201024000',
 pin: '1024',
 },
 })
 }

 // Step 3: Create profile
 const { error: profileErr } = await sb.from('profiles').insert({
 id: userId,
 full_name: 'Super Admin',
 email: CONFIG.superAdminEmail,
 phone: '233201024000',
 role: 'super_admin',
 pin_hash: pinHash,
 must_change_pin: true,
 is_active: true,
 login_attempts: 0,
 })

 if (profileErr) {
 return NextResponse.json({
 error: profileErr.message,
 hint: profileErr.message.includes('does not exist')
 ? ' The profiles table does not exist yet. Go to supabase.com → SQL Editor → run FULL-SCHEMA.sql first!'
 : 'Check Supabase logs for details',
 supabase_url: 'https://supabase.com/dashboard/project/gejtxkbatldxbbqynpfg/editor',
 }, { status: 500 })
 }

 // Step 4: Create pin_sessions table entry placeholder (if table exists)
 try {
 await sb.from('pin_sessions').select('id').limit(1)
 } catch {}

 return NextResponse.json({
 success: true,
 message: ' Super admin created successfully!',
 login: {
 url: 'https://cambridge-mu.vercel.app/login',
 phone: '0201024000',
 pin: '1024',
 note: 'You will be forced to set a new PIN on first login',
 },
 })
}
