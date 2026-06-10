-- ============================================================
-- SCHEMA ADDITIONS v2
-- Run this AFTER the main schema.sql
-- ============================================================

-- ── CLASS SIGN-IN SESSIONS ──────────────────────────────────
-- One session per class day per batch
CREATE TABLE IF NOT EXISTS class_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  class_code TEXT NOT NULL UNIQUE, -- e.g. "CCE-2503" written on board
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  signin_link_sent_at TIMESTAMPTZ, -- when WA link was auto-sent
  signin_open BOOLEAN DEFAULT true,
  total_signed_in INT DEFAULT 0,
  total_paid INT DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── SIGN-IN RECORDS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS class_signins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id),
  student_id UUID REFERENCES profiles(id), -- null if walk-in
  marketer_id UUID REFERENCES profiles(id), -- tracked from link
  -- Student details (for walk-ins or unregistered)
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  -- Verification
  class_code_entered TEXT,
  code_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  -- Payment
  payment_method TEXT, -- 'momo', 'cash', 'bank', 'skip'
  payment_status TEXT DEFAULT 'pending',
  amount_paid NUMERIC(10,2) DEFAULT 0,
  paystack_ref TEXT,
  payment_note TEXT, -- "moved to front desk"
  paid_at TIMESTAMPTZ,
  -- Attendance type
  attendance_type TEXT DEFAULT 'in_person', -- 'in_person', 'online'
  -- Device / IP for fraud detection
  ip_address TEXT,
  user_agent TEXT,
  -- Status
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── DOCUMENT LIBRARY ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'admission_letter', 'brochure', 'receipt', 'offer_letter', 'other'
  description TEXT,
  file_url TEXT NOT NULL, -- Supabase Storage URL
  file_name TEXT,
  file_size INT,
  is_template BOOLEAN DEFAULT false, -- can be personalized
  -- Template fields that get replaced
  template_fields JSONB, -- e.g. ["{{full_name}}", "{{course}}", "{{date}}"]
  is_active BOOLEAN DEFAULT true,
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PAYMENT REMINDERS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  invoice_id UUID REFERENCES invoices(id),
  outstanding_amount NUMERIC(10,2),
  reminder_type TEXT DEFAULT 'balance', -- 'balance', 'overdue', 'upcoming'
  sent_via TEXT[], -- ['sms', 'whatsapp']
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_class_sessions_batch ON class_sessions(batch_id, session_date);
CREATE INDEX IF NOT EXISTS idx_class_sessions_code ON class_sessions(class_code);
CREATE INDEX IF NOT EXISTS idx_class_signins_session ON class_signins(session_id);
CREATE INDEX IF NOT EXISTS idx_class_signins_marketer ON class_signins(marketer_id);
CREATE INDEX IF NOT EXISTS idx_class_signins_student ON class_signins(student_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type, is_active);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_signins ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Sign-in sessions: public read (for the sign-in page), admin write
CREATE POLICY "sessions_public_read" ON class_sessions FOR SELECT USING (true);
CREATE POLICY "sessions_admin_write" ON class_sessions FOR ALL
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer','receptionist','trainer'));

-- Sign-ins: public insert (walk-ins), staff read all
CREATE POLICY "signins_public_insert" ON class_signins FOR INSERT WITH CHECK (true);
CREATE POLICY "signins_staff_read" ON class_signins FOR SELECT
  USING (get_my_role() IN ('super_admin','project_manager','admissions_officer','accountant','receptionist','trainer'));

-- Documents: staff manage, all authenticated read
CREATE POLICY "documents_read" ON documents FOR SELECT USING (auth.uid() IS NOT NULL OR is_active = true);
CREATE POLICY "documents_admin" ON documents FOR ALL
  USING (get_my_role() IN ('super_admin','admissions_officer','accountant'));

-- ── TRIGGER: update session counts ──────────────────────────
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

CREATE TRIGGER trg_session_counts
AFTER INSERT OR UPDATE ON class_signins
FOR EACH ROW EXECUTE FUNCTION update_session_counts();

-- ── REALTIME ────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE class_signins;
ALTER PUBLICATION supabase_realtime ADD TABLE class_sessions;
