-- ============================================================
-- CAMBRIDGE CENTRE OF EXCELLENCE — COMPLETE ERP SCHEMA
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
  'super_admin', 'project_manager', 'marketing_officer',
  'admissions_officer', 'accountant', 'receptionist', 'trainer', 'student'
);

CREATE TYPE lead_status AS ENUM (
  'new', 'contacted', 'interested', 'follow_up',
  'ready_to_join', 'registered', 'not_interested', 'lost'
);

CREATE TYPE lead_source AS ENUM (
  'facebook', 'google', 'linkedin', 'website', 'referral', 'manual'
);

CREATE TYPE admission_status AS ENUM (
  'pending', 'awaiting_forms', 'awaiting_payment', 'admitted', 'rejected'
);

CREATE TYPE payment_method AS ENUM (
  'paystack', 'cash', 'bank_transfer', 'mobile_money'
);

CREATE TYPE payment_status AS ENUM (
  'pending', 'paid', 'failed', 'refunded', 'waived'
);

CREATE TYPE scholarship_type AS ENUM (
  'full', 'partial', 'staff_discount', 'corporate_discount'
);

CREATE TYPE class_type AS ENUM ('physical', 'online');
CREATE TYPE class_status AS ENUM ('upcoming', 'ongoing', 'completed', 'cancelled');
CREATE TYPE notification_type AS ENUM ('lead', 'assignment', 'admission', 'payment', 'reminder', 'system');

-- ============================================================
-- CORE TABLES
-- ============================================================

-- Profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role user_role NOT NULL DEFAULT 'marketing_officer',
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  marketer_code TEXT UNIQUE, -- unique slug for application links
  department TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campuses (multi-campus support)
CREATE TABLE campuses (
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

-- Courses
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  description TEXT,
  duration TEXT, -- e.g. "3 months"
  course_fee NUMERIC(10,2) DEFAULT 0,
  registration_fee NUMERIC(10,2) DEFAULT 200,
  campus_id UUID REFERENCES campuses(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batches / Cohorts
CREATE TABLE batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  course_id UUID NOT NULL REFERENCES courses(id),
  campus_id UUID REFERENCES campuses(id),
  trainer_id UUID REFERENCES profiles(id),
  class_type class_type DEFAULT 'physical',
  status class_status DEFAULT 'upcoming',
  start_date DATE,
  end_date DATE,
  schedule TEXT, -- e.g. "Mon/Wed/Fri 9am-12pm"
  venue TEXT,
  zoom_link TEXT,
  max_students INT DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LEADS / CRM
-- ============================================================

CREATE TABLE leads (
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
  -- Source metadata
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

-- Lead status history (full audit trail)
CREATE TABLE lead_status_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  old_status lead_status,
  new_status lead_status NOT NULL,
  changed_by UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lead activity log
CREATE TABLE lead_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL, -- 'call', 'email', 'whatsapp', 'note', 'meeting'
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

CREATE TABLE admissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  student_id UUID REFERENCES profiles(id),
  batch_id UUID REFERENCES batches(id),
  course_id UUID NOT NULL REFERENCES courses(id),
  campus_id UUID REFERENCES campuses(id),
  status admission_status DEFAULT 'pending',
  assigned_officer UUID REFERENCES profiles(id),
  admission_number TEXT UNIQUE,
  offer_letter_sent_at TIMESTAMPTZ,
  welcome_email_sent_at TIMESTAMPTZ,
  documents_deadline TIMESTAMPTZ,
  auto_sent BOOLEAN DEFAULT false, -- true if system auto-sent docs
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Student Applications
CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tracking
  marketer_id UUID REFERENCES profiles(id),
  lead_id UUID REFERENCES leads(id),
  -- Personal
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
  -- Academic
  course_id UUID REFERENCES courses(id),
  batch_preference TEXT,
  scholarship_requested BOOLEAN DEFAULT false,
  scholarship_type scholarship_type,
  scholarship_reason TEXT,
  -- Files
  passport_photo_url TEXT,
  -- Payment
  payment_method payment_method,
  payment_status payment_status DEFAULT 'pending',
  paystack_ref TEXT,
  paid_at TIMESTAMPTZ,
  amount_paid NUMERIC(10,2) DEFAULT 0,
  -- Status
  is_submitted BOOLEAN DEFAULT false,
  submitted_at TIMESTAMPTZ,
  admission_id UUID REFERENCES admissions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FINANCE
-- ============================================================

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT UNIQUE NOT NULL,
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

CREATE TABLE payments (
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

CREATE TABLE scholarships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES profiles(id),
  application_id UUID REFERENCES applications(id),
  type scholarship_type NOT NULL,
  discount_amount NUMERIC(10,2),
  discount_percent NUMERIC(5,2),
  reason TEXT,
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending', -- pending, approved, rejected
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
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

CREATE TABLE sms_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  provider TEXT DEFAULT 'hubtel',
  provider_response JSONB,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient TEXT NOT NULL,
  template TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  provider_response JSONB,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE email_logs (
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
-- ATTENDANCE & CLASS MANAGEMENT
-- ============================================================

CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  student_id UUID NOT NULL REFERENCES profiles(id),
  date DATE NOT NULL,
  status TEXT DEFAULT 'present', -- present, absent, late, excused
  notes TEXT,
  recorded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, student_id, date)
);

CREATE TABLE batch_students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES batches(id),
  student_id UUID NOT NULL REFERENCES profiles(id),
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, student_id)
);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_logs (
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
-- INDEXES
-- ============================================================

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX idx_lead_logs_lead_id ON lead_status_logs(lead_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id, is_read);
CREATE INDEX idx_payments_student ON payments(student_id);
CREATE INDEX idx_applications_marketer ON applications(marketer_id);
CREATE INDEX idx_admissions_status ON admissions(status);
CREATE INDEX idx_attendance_batch ON attendance(batch_id, date);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_admissions_updated_at BEFORE UPDATE ON admissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-log lead status changes
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

CREATE TRIGGER trg_log_lead_status
AFTER UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION log_lead_status_change();

-- Auto-generate admission number
CREATE OR REPLACE FUNCTION generate_admission_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.admission_number := 'CCE-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
    LPAD(NEXTVAL('admission_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE admission_seq START 1001;
CREATE TRIGGER trg_admission_number BEFORE INSERT ON admissions
  FOR EACH ROW EXECUTE FUNCTION generate_admission_number();

-- Auto-generate receipt number
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.receipt_number := 'RCT-' || TO_CHAR(NOW(), 'YYYYMM') || '-' ||
    LPAD(NEXTVAL('receipt_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE receipt_seq START 1;
CREATE TRIGGER trg_receipt_number BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION generate_receipt_number();

-- Auto-generate invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYYYMM') || '-' ||
    LPAD(NEXTVAL('invoice_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE invoice_seq START 1;
CREATE TRIGGER trg_invoice_number BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION generate_invoice_number();

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

-- Helper: get current user role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Profiles: users see their own, admins see all
CREATE POLICY "profiles_own" ON profiles FOR SELECT
  USING (id = auth.uid() OR get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant'));
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (id = auth.uid());

-- Leads: marketers see only their assigned leads; PM/admin see all
CREATE POLICY "leads_marketer" ON leads FOR SELECT
  USING (
    get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant')
    OR assigned_to = auth.uid()
  );
CREATE POLICY "leads_insert" ON leads FOR INSERT
  WITH CHECK (get_my_role() IN ('super_admin','project_manager','marketing_officer'));
CREATE POLICY "leads_update" ON leads FOR UPDATE
  USING (
    get_my_role() IN ('super_admin','project_manager')
    OR assigned_to = auth.uid()
  );

-- Notifications: own only
CREATE POLICY "notifications_own" ON notifications FOR ALL
  USING (user_id = auth.uid());

-- Applications: marketer sees their own; admissions/finance see all
CREATE POLICY "applications_select" ON applications FOR SELECT
  USING (
    get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant')
    OR marketer_id = auth.uid()
  );

-- Admissions: admissions officer + admin
CREATE POLICY "admissions_select" ON admissions FOR SELECT
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant'));

-- Payments: accountant + admin
CREATE POLICY "payments_select" ON payments FOR SELECT
  USING (get_my_role() IN ('super_admin','accountant','admissions_officer'));

-- Invoices: accountant + admin + own student
CREATE POLICY "invoices_select" ON invoices FOR SELECT
  USING (
    get_my_role() IN ('super_admin','accountant')
    OR student_id = auth.uid()
  );

-- Lead activities: assigned marketer + admin
CREATE POLICY "activities_select" ON lead_activities FOR SELECT
  USING (
    get_my_role() IN ('super_admin','project_manager')
    OR created_by = auth.uid()
  );

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE admissions;
