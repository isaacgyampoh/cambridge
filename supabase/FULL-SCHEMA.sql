-- ============================================================
-- CAMBRIDGE CENTRE OF EXCELLENCE — COMPLETE DATABASE SCHEMA
-- Run this ONCE in Supabase SQL Editor
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'super_admin', 'project_manager', 'marketing_officer',
    'admissions_officer', 'accountant', 'receptionist', 'trainer', 'student'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM (
    'new', 'contacted', 'interested', 'follow_up',
    'ready_to_join', 'registered', 'not_interested', 'lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_source AS ENUM (
    'facebook', 'google', 'linkedin', 'website', 'referral', 'manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE admission_status AS ENUM (
    'pending', 'awaiting_forms', 'awaiting_payment', 'admitted', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'paystack', 'cash', 'bank_transfer', 'mobile_money'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'pending', 'paid', 'failed', 'refunded', 'waived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scholarship_type AS ENUM (
    'full', 'partial', 'staff_discount', 'corporate_discount'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE class_type AS ENUM ('physical', 'online');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE class_status AS ENUM ('upcoming', 'ongoing', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('lead', 'assignment', 'admission', 'payment', 'reminder', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role user_role NOT NULL DEFAULT 'marketing_officer',
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  marketer_code TEXT UNIQUE,
  department TEXT,
  -- PIN Auth
  pin_hash TEXT,
  pin_set_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  login_attempts INT DEFAULT 0,
  locked_until TIMESTAMPTZ,
  must_change_pin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  city TEXT,
  country TEXT DEFAULT 'Ghana',
  address TEXT,
  phone TEXT,
  email TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  description TEXT,
  duration TEXT,
  course_fee NUMERIC(10,2) DEFAULT 0,
  registration_fee NUMERIC(10,2) DEFAULT 200,
  campus_id UUID REFERENCES campuses(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  course_id UUID NOT NULL REFERENCES courses(id),
  campus_id UUID REFERENCES campuses(id),
  trainer_id UUID REFERENCES profiles(id),
  class_type class_type DEFAULT 'physical',
  status class_status DEFAULT 'upcoming',
  start_date DATE,
  end_date DATE,
  schedule TEXT,
  venue TEXT,
  zoom_link TEXT,
  max_students INT DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LEADS / CRM
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  gender TEXT,
  country TEXT DEFAULT 'Ghana',
  city TEXT,
  source lead_source NOT NULL DEFAULT 'manual',
  status lead_status NOT NULL DEFAULT 'new',
  course_interest TEXT,
  notes TEXT,
  assigned_to UUID REFERENCES profiles(id),
  assigned_by UUID REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ,
  campus_id UUID REFERENCES campuses(id),
  fb_lead_id TEXT,
  google_lead_id TEXT,
  linkedin_lead_id TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer_id UUID REFERENCES profiles(id),
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_status_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  old_status lead_status,
  new_status lead_status NOT NULL,
  changed_by UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  subject TEXT,
  description TEXT,
  outcome TEXT,
  next_follow_up TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ADMISSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS admissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  student_id UUID REFERENCES profiles(id),
  batch_id UUID REFERENCES batches(id),
  course_id UUID REFERENCES courses(id),
  campus_id UUID REFERENCES campuses(id),
  status admission_status DEFAULT 'pending',
  assigned_officer UUID REFERENCES profiles(id),
  admission_number TEXT UNIQUE,
  offer_letter_sent_at TIMESTAMPTZ,
  welcome_email_sent_at TIMESTAMPTZ,
  documents_deadline TIMESTAMPTZ,
  auto_sent BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  marketer_id UUID REFERENCES profiles(id),
  lead_id UUID REFERENCES leads(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  gender TEXT,
  date_of_birth DATE,
  country TEXT,
  city TEXT,
  address TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  course_id UUID REFERENCES courses(id),
  batch_preference TEXT,
  scholarship_requested BOOLEAN DEFAULT false,
  scholarship_type scholarship_type,
  scholarship_reason TEXT,
  passport_photo_url TEXT,
  payment_method payment_method,
  payment_status payment_status DEFAULT 'pending',
  paystack_ref TEXT,
  paid_at TIMESTAMPTZ,
  amount_paid NUMERIC(10,2) DEFAULT 0,
  is_submitted BOOLEAN DEFAULT false,
  submitted_at TIMESTAMPTZ,
  admission_id UUID REFERENCES admissions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FINANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT UNIQUE,
  student_id UUID NOT NULL REFERENCES profiles(id),
  admission_id UUID REFERENCES admissions(id),
  course_id UUID REFERENCES courses(id),
  campus_id UUID REFERENCES campuses(id),
  total_amount NUMERIC(10,2) NOT NULL,
  amount_paid NUMERIC(10,2) DEFAULT 0,
  outstanding NUMERIC(10,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  due_date DATE,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES invoices(id),
  student_id UUID REFERENCES profiles(id),
  application_id UUID REFERENCES applications(id),
  amount NUMERIC(10,2) NOT NULL,
  method payment_method NOT NULL,
  status payment_status DEFAULT 'pending',
  paystack_ref TEXT,
  paystack_response JSONB,
  receipt_number TEXT UNIQUE,
  notes TEXT,
  recorded_by UUID REFERENCES profiles(id),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scholarships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES profiles(id),
  application_id UUID REFERENCES applications(id),
  type scholarship_type NOT NULL,
  discount_amount NUMERIC(10,2),
  discount_percent NUMERIC(5,2),
  reason TEXT,
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  invoice_id UUID REFERENCES invoices(id),
  outstanding_amount NUMERIC(10,2),
  reminder_type TEXT DEFAULT 'balance',
  sent_via TEXT[],
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS & LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  provider TEXT DEFAULT 'arkesel',
  provider_response JSONB,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient TEXT NOT NULL,
  template TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  provider_response JSONB,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  template TEXT,
  status TEXT DEFAULT 'pending',
  provider_response JSONB,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CLASS MANAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS batch_students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  student_id UUID NOT NULL REFERENCES profiles(id),
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  student_id UUID NOT NULL REFERENCES profiles(id),
  date DATE NOT NULL,
  status TEXT DEFAULT 'present',
  notes TEXT,
  recorded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, student_id, date)
);

-- ============================================================
-- CLASS SIGN-IN SYSTEM
-- ============================================================

CREATE TABLE IF NOT EXISTS class_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  class_code TEXT NOT NULL UNIQUE,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  signin_link_sent_at TIMESTAMPTZ,
  signin_open BOOLEAN DEFAULT true,
  total_signed_in INT DEFAULT 0,
  total_paid INT DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_signins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id),
  student_id UUID REFERENCES profiles(id),
  marketer_id UUID REFERENCES profiles(id),
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  class_code_entered TEXT,
  code_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  payment_method TEXT,
  payment_status TEXT DEFAULT 'pending',
  amount_paid NUMERIC(10,2) DEFAULT 0,
  paystack_ref TEXT,
  payment_note TEXT,
  paid_at TIMESTAMPTZ,
  attendance_type TEXT DEFAULT 'in_person',
  ip_address TEXT,
  user_agent TEXT,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DOCUMENT LIBRARY
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_size INT,
  is_template BOOLEAN DEFAULT false,
  template_fields JSONB,
  is_active BOOLEAN DEFAULT true,
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ALUMNI & SUCCESS STORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS alumni (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES profiles(id),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  photo_url TEXT,
  course_completed TEXT NOT NULL,
  batch_name TEXT,
  graduation_date DATE,
  certification_number TEXT,
  current_job_title TEXT,
  current_company TEXT,
  linkedin_url TEXT,
  success_story TEXT,
  testimonial TEXT,
  video_url TEXT,
  certificate_url TEXT,
  is_featured BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT false,
  added_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MARKETER PERFORMANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS marketer_daily_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  marketer_id UUID NOT NULL REFERENCES profiles(id),
  stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  calls_made INT DEFAULT 0,
  whatsapp_sent INT DEFAULT 0,
  emails_sent INT DEFAULT 0,
  meetings_held INT DEFAULT 0,
  leads_contacted INT DEFAULT 0,
  leads_interested INT DEFAULT 0,
  leads_converted INT DEFAULT 0,
  leads_lost INT DEFAULT 0,
  applications_generated INT DEFAULT 0,
  applications_paid INT DEFAULT 0,
  revenue_attributed NUMERIC(10,2) DEFAULT 0,
  daily_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(marketer_id, stat_date)
);

CREATE TABLE IF NOT EXISTS marketer_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  marketer_id UUID NOT NULL REFERENCES profiles(id),
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT DEFAULT 'warning',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketer_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  marketer_id UUID NOT NULL REFERENCES profiles(id),
  period TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_leads INT DEFAULT 0,
  target_conversions INT DEFAULT 0,
  target_revenue NUMERIC(10,2) DEFAULT 0,
  set_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personalized_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES batches(id),
  marketer_id UUID REFERENCES profiles(id),
  student_id UUID REFERENCES profiles(id),
  reminder_type TEXT NOT NULL,
  message_sent TEXT,
  whatsapp_status TEXT DEFAULT 'pending',
  sms_status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BROADCAST MESSAGING
-- ============================================================

CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  channels TEXT[] DEFAULT ARRAY['whatsapp'],
  target_type TEXT NOT NULL,
  target_filters JSONB,
  target_count INT DEFAULT 0,
  sent_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  status TEXT DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  recipient_type TEXT,
  recipient_id UUID,
  status TEXT DEFAULT 'pending',
  error TEXT,
  sent_at TIMESTAMPTZ
);

-- ============================================================
-- FOLLOW-UP QUEUE
-- ============================================================

CREATE TABLE IF NOT EXISTS follow_up_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  marketer_id UUID NOT NULL REFERENCES profiles(id),
  follow_up_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  priority TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'pending',
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REFERRALS
-- ============================================================

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID NOT NULL REFERENCES profiles(id),
  referrer_type TEXT DEFAULT 'student',
  referred_lead_id UUID REFERENCES leads(id),
  referred_name TEXT NOT NULL,
  referred_phone TEXT,
  referred_email TEXT,
  status TEXT DEFAULT 'pending',
  reward_type TEXT,
  reward_amount NUMERIC(10,2),
  reward_paid BOOLEAN DEFAULT false,
  reward_paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CERTIFICATES
-- ============================================================

CREATE TABLE IF NOT EXISTS certificates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  admission_id UUID REFERENCES admissions(id),
  course_id UUID REFERENCES courses(id),
  batch_id UUID REFERENCES batches(id),
  certificate_number TEXT UNIQUE,
  issued_date DATE DEFAULT CURRENT_DATE,
  student_name TEXT NOT NULL,
  course_name TEXT NOT NULL,
  template_url TEXT,
  final_url TEXT,
  issued_by UUID REFERENCES profiles(id),
  is_verified BOOLEAN DEFAULT true,
  verification_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WHATSAPP INBOX (inbound)
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_inbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_phone TEXT NOT NULL,
  from_name TEXT,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  media_url TEXT,
  is_read BOOLEAN DEFAULT false,
  lead_id UUID REFERENCES leads(id),
  replied_at TIMESTAMPTZ,
  reply_text TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SCHEDULED TASKS
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  task_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  run_at TIMESTAMPTZ NOT NULL,
  repeat_pattern TEXT,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PIPELINE EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  details TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PIN AUTH TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  email TEXT NOT NULL,
  role user_role NOT NULL,
  full_name TEXT,
  phone TEXT,
  department TEXT,
  initial_pin TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  is_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pin_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '8 hours',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  email TEXT,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SEQUENCES
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS admission_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS receipt_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS cert_seq START 1001;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_logs_lead_id ON lead_status_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_applications_marketer ON applications(marketer_id);
CREATE INDEX IF NOT EXISTS idx_admissions_status ON admissions(status);
CREATE INDEX IF NOT EXISTS idx_attendance_batch ON attendance(batch_id, date);
CREATE INDEX IF NOT EXISTS idx_class_sessions_batch ON class_sessions(batch_id, session_date);
CREATE INDEX IF NOT EXISTS idx_class_sessions_code ON class_sessions(class_code);
CREATE INDEX IF NOT EXISTS idx_class_signins_session ON class_signins(session_id);
CREATE INDEX IF NOT EXISTS idx_class_signins_marketer ON class_signins(marketer_id);
CREATE INDEX IF NOT EXISTS idx_alumni_published ON alumni(is_published, is_featured);
CREATE INDEX IF NOT EXISTS idx_marketer_stats_date ON marketer_daily_stats(marketer_id, stat_date DESC);
CREATE INDEX IF NOT EXISTS idx_follow_up_queue ON follow_up_queue(marketer_id, status, follow_up_at);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_pin_sessions_token ON pin_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_pin_sessions_user ON pin_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_staff_invites_token ON staff_invites(token, is_used);
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbox ON whatsapp_inbox(is_read, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_certificates_verify ON certificates(verification_code);

-- ============================================================
-- FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_lead_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO lead_status_logs(lead_id, old_status, new_status, changed_by)
    VALUES(NEW.id, OLD.status, NEW.status, NEW.assigned_to);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_admission_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.admission_number := 'CCE-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
    LPAD(NEXTVAL('admission_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.receipt_number := 'RCT-' || TO_CHAR(NOW(), 'YYYYMM') || '-' ||
    LPAD(NEXTVAL('receipt_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYYYMM') || '-' ||
    LPAD(NEXTVAL('invoice_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_certificate_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.certificate_number := 'CCE-CERT-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
    LPAD(NEXTVAL('cert_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_session_counts()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE class_sessions SET
    total_signed_in = (SELECT COUNT(*) FROM class_signins WHERE session_id = NEW.session_id AND code_verified = true),
    total_paid = (SELECT COUNT(*) FROM class_signins WHERE session_id = NEW.session_id AND payment_status = 'paid')
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_marketer_stats_on_lead_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.assigned_to IS NOT NULL THEN
    INSERT INTO marketer_daily_stats (marketer_id, stat_date)
    VALUES (NEW.assigned_to, CURRENT_DATE)
    ON CONFLICT (marketer_id, stat_date) DO NOTHING;
    IF NEW.status = 'contacted' THEN
      UPDATE marketer_daily_stats SET leads_contacted = leads_contacted + 1 WHERE marketer_id = NEW.assigned_to AND stat_date = CURRENT_DATE;
    ELSIF NEW.status = 'interested' THEN
      UPDATE marketer_daily_stats SET leads_interested = leads_interested + 1 WHERE marketer_id = NEW.assigned_to AND stat_date = CURRENT_DATE;
    ELSIF NEW.status = 'ready_to_join' THEN
      UPDATE marketer_daily_stats SET leads_converted = leads_converted + 1 WHERE marketer_id = NEW.assigned_to AND stat_date = CURRENT_DATE;
    ELSIF NEW.status IN ('not_interested', 'lost') THEN
      UPDATE marketer_daily_stats SET leads_lost = leads_lost + 1 WHERE marketer_id = NEW.assigned_to AND stat_date = CURRENT_DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_marketer_stats_on_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO marketer_daily_stats (marketer_id, stat_date)
    VALUES (NEW.created_by, CURRENT_DATE)
    ON CONFLICT (marketer_id, stat_date) DO NOTHING;
    IF NEW.activity_type = 'call' THEN
      UPDATE marketer_daily_stats SET calls_made = calls_made + 1 WHERE marketer_id = NEW.created_by AND stat_date = CURRENT_DATE;
    ELSIF NEW.activity_type = 'whatsapp' THEN
      UPDATE marketer_daily_stats SET whatsapp_sent = whatsapp_sent + 1 WHERE marketer_id = NEW.created_by AND stat_date = CURRENT_DATE;
    ELSIF NEW.activity_type = 'email' THEN
      UPDATE marketer_daily_stats SET emails_sent = emails_sent + 1 WHERE marketer_id = NEW.created_by AND stat_date = CURRENT_DATE;
    ELSIF NEW.activity_type = 'meeting' THEN
      UPDATE marketer_daily_stats SET meetings_held = meetings_held + 1 WHERE marketer_id = NEW.created_by AND stat_date = CURRENT_DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION verify_session_token(p_token TEXT)
RETURNS TABLE(user_id UUID, role user_role, full_name TEXT, is_valid BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT ps.user_id, p.role, p.full_name,
    (ps.expires_at > NOW() AND p.is_active = true) AS is_valid
  FROM pin_sessions ps
  JOIN profiles p ON p.id = ps.user_id
  WHERE ps.session_token = p_token;
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_admissions_updated_at ON admissions;
CREATE TRIGGER trg_admissions_updated_at BEFORE UPDATE ON admissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_alumni_updated_at ON alumni;
CREATE TRIGGER trg_alumni_updated_at BEFORE UPDATE ON alumni FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_log_lead_status ON leads;
CREATE TRIGGER trg_log_lead_status AFTER UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION log_lead_status_change();

DROP TRIGGER IF EXISTS trg_admission_number ON admissions;
CREATE TRIGGER trg_admission_number BEFORE INSERT ON admissions FOR EACH ROW EXECUTE FUNCTION generate_admission_number();

DROP TRIGGER IF EXISTS trg_receipt_number ON payments;
CREATE TRIGGER trg_receipt_number BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION generate_receipt_number();

DROP TRIGGER IF EXISTS trg_invoice_number ON invoices;
CREATE TRIGGER trg_invoice_number BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION generate_invoice_number();

DROP TRIGGER IF EXISTS trg_cert_number ON certificates;
CREATE TRIGGER trg_cert_number BEFORE INSERT ON certificates FOR EACH ROW EXECUTE FUNCTION generate_certificate_number();

DROP TRIGGER IF EXISTS trg_session_counts ON class_signins;
CREATE TRIGGER trg_session_counts AFTER INSERT OR UPDATE ON class_signins FOR EACH ROW EXECUTE FUNCTION update_session_counts();

DROP TRIGGER IF EXISTS trg_marketer_stats_lead ON leads;
CREATE TRIGGER trg_marketer_stats_lead AFTER UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_marketer_stats_on_lead_change();

DROP TRIGGER IF EXISTS trg_marketer_stats_activity ON lead_activities;
CREATE TRIGGER trg_marketer_stats_activity AFTER INSERT ON lead_activities FOR EACH ROW EXECUTE FUNCTION update_marketer_stats_on_activity();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_signins ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE alumni ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketer_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketer_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_sessions ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "profiles_own" ON profiles;
CREATE POLICY "profiles_own" ON profiles FOR SELECT
  USING (id = auth.uid() OR get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant'));
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (id = auth.uid() OR get_my_role() = 'super_admin');

-- Leads
DROP POLICY IF EXISTS "leads_select" ON leads;
CREATE POLICY "leads_select" ON leads FOR SELECT
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant') OR assigned_to = auth.uid());
DROP POLICY IF EXISTS "leads_insert" ON leads;
CREATE POLICY "leads_insert" ON leads FOR INSERT
  WITH CHECK (get_my_role() IN ('super_admin','project_manager','marketing_officer'));
DROP POLICY IF EXISTS "leads_update" ON leads;
CREATE POLICY "leads_update" ON leads FOR UPDATE
  USING (get_my_role() IN ('super_admin','project_manager') OR assigned_to = auth.uid());

-- Notifications: own only
DROP POLICY IF EXISTS "notifications_own" ON notifications;
CREATE POLICY "notifications_own" ON notifications FOR ALL USING (user_id = auth.uid());

-- Applications
DROP POLICY IF EXISTS "applications_select" ON applications;
CREATE POLICY "applications_select" ON applications FOR SELECT
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant') OR marketer_id = auth.uid());
DROP POLICY IF EXISTS "applications_insert" ON applications;
CREATE POLICY "applications_insert" ON applications FOR INSERT WITH CHECK (true);

-- Admissions
DROP POLICY IF EXISTS "admissions_select" ON admissions;
CREATE POLICY "admissions_select" ON admissions FOR SELECT
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant'));
DROP POLICY IF EXISTS "admissions_write" ON admissions;
CREATE POLICY "admissions_write" ON admissions FOR ALL
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer'));

-- Payments & Invoices
DROP POLICY IF EXISTS "payments_select" ON payments;
CREATE POLICY "payments_select" ON payments FOR SELECT
  USING (get_my_role() IN ('super_admin','accountant','admissions_officer') OR student_id = auth.uid());
DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select" ON invoices FOR SELECT
  USING (get_my_role() IN ('super_admin','accountant') OR student_id = auth.uid());

-- Lead activities
DROP POLICY IF EXISTS "activities_select" ON lead_activities;
CREATE POLICY "activities_select" ON lead_activities FOR SELECT
  USING (get_my_role() IN ('super_admin','project_manager') OR created_by = auth.uid());
DROP POLICY IF EXISTS "activities_insert" ON lead_activities;
CREATE POLICY "activities_insert" ON lead_activities FOR INSERT WITH CHECK (true);

-- Class sessions: public read for sign-in page
DROP POLICY IF EXISTS "sessions_public_read" ON class_sessions;
CREATE POLICY "sessions_public_read" ON class_sessions FOR SELECT USING (true);
DROP POLICY IF EXISTS "sessions_admin_write" ON class_sessions;
CREATE POLICY "sessions_admin_write" ON class_sessions FOR ALL
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer','receptionist','trainer'));

-- Class sign-ins: public insert (walk-ins)
DROP POLICY IF EXISTS "signins_public_insert" ON class_signins;
CREATE POLICY "signins_public_insert" ON class_signins FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "signins_public_update" ON class_signins;
CREATE POLICY "signins_public_update" ON class_signins FOR UPDATE USING (true);
DROP POLICY IF EXISTS "signins_staff_read" ON class_signins;
CREATE POLICY "signins_staff_read" ON class_signins FOR SELECT
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant','receptionist','trainer'));

-- Documents
DROP POLICY IF EXISTS "documents_read" ON documents;
CREATE POLICY "documents_read" ON documents FOR SELECT USING (is_active = true OR get_my_role() IN ('super_admin','admissions_officer'));
DROP POLICY IF EXISTS "documents_admin" ON documents;
CREATE POLICY "documents_admin" ON documents FOR ALL
  USING (get_my_role() IN ('super_admin','admissions_officer','accountant'));

-- Alumni
DROP POLICY IF EXISTS "alumni_read" ON alumni;
CREATE POLICY "alumni_read" ON alumni FOR SELECT
  USING (is_published = true OR get_my_role() IN ('super_admin','project_manager','admissions_officer'));
DROP POLICY IF EXISTS "alumni_admin" ON alumni;
CREATE POLICY "alumni_admin" ON alumni FOR ALL
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer'));

-- Marketer stats
DROP POLICY IF EXISTS "stats_own_or_admin" ON marketer_daily_stats;
CREATE POLICY "stats_own_or_admin" ON marketer_daily_stats FOR SELECT
  USING (marketer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));
DROP POLICY IF EXISTS "stats_write" ON marketer_daily_stats;
CREATE POLICY "stats_write" ON marketer_daily_stats FOR ALL USING (marketer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));

-- Marketer alerts
DROP POLICY IF EXISTS "alerts_own" ON marketer_alerts;
CREATE POLICY "alerts_own" ON marketer_alerts FOR SELECT
  USING (marketer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));
DROP POLICY IF EXISTS "alerts_admin_write" ON marketer_alerts;
CREATE POLICY "alerts_admin_write" ON marketer_alerts FOR ALL
  USING (get_my_role() IN ('super_admin','project_manager'));

-- Broadcasts
DROP POLICY IF EXISTS "broadcasts_admin" ON broadcasts;
CREATE POLICY "broadcasts_admin" ON broadcasts FOR ALL
  USING (get_my_role() IN ('super_admin','project_manager'));

-- Referrals
DROP POLICY IF EXISTS "referrals_own" ON referrals;
CREATE POLICY "referrals_own" ON referrals FOR SELECT
  USING (referrer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));
DROP POLICY IF EXISTS "referrals_insert" ON referrals;
CREATE POLICY "referrals_insert" ON referrals FOR INSERT
  WITH CHECK (referrer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));

-- Certificates
DROP POLICY IF EXISTS "certificates_own" ON certificates;
CREATE POLICY "certificates_own" ON certificates FOR SELECT
  USING (student_id = auth.uid() OR get_my_role() IN ('super_admin','admissions_officer','project_manager'));
DROP POLICY IF EXISTS "certificates_admin" ON certificates;
CREATE POLICY "certificates_admin" ON certificates FOR ALL
  USING (get_my_role() IN ('super_admin','admissions_officer'));

-- Follow-up queue
DROP POLICY IF EXISTS "follow_up_own" ON follow_up_queue;
CREATE POLICY "follow_up_own" ON follow_up_queue FOR ALL
  USING (marketer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));

-- WhatsApp inbox
DROP POLICY IF EXISTS "wa_inbox_staff" ON whatsapp_inbox;
CREATE POLICY "wa_inbox_staff" ON whatsapp_inbox FOR ALL
  USING (get_my_role() IN ('super_admin','project_manager','marketing_officer'));

-- Staff invites
DROP POLICY IF EXISTS "invites_admin" ON staff_invites;
CREATE POLICY "invites_admin" ON staff_invites FOR ALL USING (get_my_role() = 'super_admin');

-- PIN sessions
DROP POLICY IF EXISTS "sessions_own" ON pin_sessions;
CREATE POLICY "sessions_own" ON pin_sessions FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- REALTIME PUBLICATIONS
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE admissions;
ALTER PUBLICATION supabase_realtime ADD TABLE class_signins;
ALTER PUBLICATION supabase_realtime ADD TABLE class_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE marketer_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE alumni;
ALTER PUBLICATION supabase_realtime ADD TABLE broadcasts;
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_inbox;
ALTER PUBLICATION supabase_realtime ADD TABLE follow_up_queue;

-- ============================================================
-- DONE ✅
-- ============================================================
SELECT 'Cambridge CE Database Schema installed successfully! 🎓' AS status;
