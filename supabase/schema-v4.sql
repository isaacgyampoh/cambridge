-- ============================================================
-- SCHEMA v4 — Advanced Features
-- Run AFTER schema-v3.sql
-- ============================================================

-- ── BROADCAST MESSAGES ───────────────────────────────────────
-- Send bulk WhatsApp/SMS to segments of leads or students
CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  channels TEXT[] DEFAULT ARRAY['whatsapp'],  -- 'whatsapp', 'sms', 'email'
  target_type TEXT NOT NULL,  -- 'all_leads', 'leads_by_status', 'leads_by_source', 'all_students', 'batch_students', 'custom'
  target_filters JSONB,       -- e.g. {"status": "interested", "source": "facebook"}
  target_count INT DEFAULT 0,
  sent_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  status TEXT DEFAULT 'draft',  -- 'draft', 'sending', 'sent', 'failed'
  scheduled_at TIMESTAMPTZ,     -- null = send immediately
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  recipient_type TEXT,  -- 'lead', 'student'
  recipient_id UUID,
  status TEXT DEFAULT 'pending',  -- 'pending', 'sent', 'failed'
  error TEXT,
  sent_at TIMESTAMPTZ
);

-- ── SCHEDULED TASKS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  task_type TEXT NOT NULL,  -- 'broadcast', 'reminder', 'follow_up', 'report'
  payload JSONB NOT NULL,
  run_at TIMESTAMPTZ NOT NULL,
  repeat_pattern TEXT,      -- 'once', 'daily', 'weekly', 'monthly'
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',  -- 'pending', 'running', 'done', 'failed'
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── REFERRAL PROGRAM ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID NOT NULL REFERENCES profiles(id),  -- student who referred
  referrer_type TEXT DEFAULT 'student',  -- 'student', 'marketer', 'alumni'
  referred_lead_id UUID REFERENCES leads(id),
  referred_name TEXT NOT NULL,
  referred_phone TEXT,
  referred_email TEXT,
  status TEXT DEFAULT 'pending',  -- 'pending', 'enrolled', 'paid', 'rewarded'
  reward_type TEXT,     -- 'discount', 'cash', 'gift'
  reward_amount NUMERIC(10,2),
  reward_paid BOOLEAN DEFAULT false,
  reward_paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CERTIFICATES ─────────────────────────────────────────────
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
  template_url TEXT,   -- base PDF template
  final_url TEXT,      -- personalized generated PDF
  issued_by UUID REFERENCES profiles(id),
  is_verified BOOLEAN DEFAULT true,
  verification_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PIPELINE EVENTS (for Kanban real-time) ───────────────────
CREATE TABLE IF NOT EXISTS pipeline_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,  -- 'moved', 'assigned', 'note', 'call', 'won', 'lost'
  from_stage TEXT,
  to_stage TEXT,
  details TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── WHATSAPP INBOX (inbound messages) ────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_inbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_phone TEXT NOT NULL,
  from_name TEXT,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',  -- 'text', 'image', 'document'
  media_url TEXT,
  is_read BOOLEAN DEFAULT false,
  lead_id UUID REFERENCES leads(id),
  replied_at TIMESTAMPTZ,
  reply_text TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── FOLLOW-UP QUEUE ──────────────────────────────────────────
-- Marketers' smart follow-up reminders
CREATE TABLE IF NOT EXISTS follow_up_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  marketer_id UUID NOT NULL REFERENCES profiles(id),
  follow_up_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  priority TEXT DEFAULT 'normal',  -- 'high', 'normal', 'low'
  status TEXT DEFAULT 'pending',   -- 'pending', 'done', 'snoozed'
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients ON broadcast_recipients(broadcast_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks ON scheduled_tasks(status, run_at);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_certificates_student ON certificates(student_id);
CREATE INDEX IF NOT EXISTS idx_certificates_verify ON certificates(verification_code);
CREATE INDEX IF NOT EXISTS idx_follow_up_queue ON follow_up_queue(marketer_id, status, follow_up_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbox ON whatsapp_inbox(is_read, received_at DESC);

-- ── CERTIFICATE NUMBER SEQUENCE ─────────────────────────────
CREATE SEQUENCE IF NOT EXISTS cert_seq START 1001;
CREATE OR REPLACE FUNCTION generate_certificate_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.certificate_number := 'CCE-CERT-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
    LPAD(NEXTVAL('cert_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cert_number BEFORE INSERT ON certificates
FOR EACH ROW EXECUTE FUNCTION generate_certificate_number();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "broadcasts_admin" ON broadcasts FOR ALL
  USING (get_my_role() IN ('super_admin', 'project_manager'));

CREATE POLICY "referrals_own_or_admin" ON referrals FOR SELECT
  USING (referrer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));
CREATE POLICY "referrals_insert" ON referrals FOR INSERT
  WITH CHECK (referrer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));

CREATE POLICY "certificates_own_or_admin" ON certificates FOR SELECT
  USING (student_id = auth.uid() OR get_my_role() IN ('super_admin','admissions_officer','project_manager'));
CREATE POLICY "certificates_admin_write" ON certificates FOR ALL
  USING (get_my_role() IN ('super_admin','admissions_officer'));

CREATE POLICY "follow_up_own" ON follow_up_queue FOR ALL
  USING (marketer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));

CREATE POLICY "wa_inbox_staff" ON whatsapp_inbox FOR ALL
  USING (get_my_role() IN ('super_admin','project_manager','marketing_officer'));

-- ── REALTIME ────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE broadcasts;
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_inbox;
ALTER PUBLICATION supabase_realtime ADD TABLE follow_up_queue;
