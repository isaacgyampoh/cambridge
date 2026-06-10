-- ============================================================
-- SCHEMA v3 — Alumni, Marketer Performance, Advanced Features
-- Run AFTER schema.sql and schema-v2.sql
-- ============================================================

-- ── ALUMNI / SUCCESS STORIES ─────────────────────────────────
CREATE TABLE IF NOT EXISTS alumni (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES profiles(id),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  photo_url TEXT,
  -- Academic
  course_completed TEXT NOT NULL,
  batch_name TEXT,
  graduation_date DATE,
  certification_number TEXT,
  -- Professional
  current_job_title TEXT,
  current_company TEXT,
  linkedin_url TEXT,
  -- Story
  success_story TEXT,
  testimonial TEXT,
  -- Media
  video_url TEXT,
  certificate_url TEXT,
  -- Display
  is_featured BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT false,
  -- Meta
  added_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── MARKETER DAILY ACTIVITY LOG ──────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_daily_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  marketer_id UUID NOT NULL REFERENCES profiles(id),
  stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Activity
  calls_made INT DEFAULT 0,
  whatsapp_sent INT DEFAULT 0,
  emails_sent INT DEFAULT 0,
  meetings_held INT DEFAULT 0,
  -- Pipeline
  leads_contacted INT DEFAULT 0,
  leads_interested INT DEFAULT 0,
  leads_converted INT DEFAULT 0, -- moved to ready_to_join
  leads_lost INT DEFAULT 0,
  -- Applications
  applications_generated INT DEFAULT 0,
  applications_paid INT DEFAULT 0,
  -- Revenue attributed
  revenue_attributed NUMERIC(10,2) DEFAULT 0,
  -- Notes
  daily_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(marketer_id, stat_date)
);

-- ── MARKETER PERFORMANCE ALERTS ──────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  marketer_id UUID NOT NULL REFERENCES profiles(id),
  alert_type TEXT NOT NULL, -- 'no_activity', 'low_conversion', 'uncontacted_leads', 'target_missed'
  message TEXT NOT NULL,
  severity TEXT DEFAULT 'warning', -- 'info', 'warning', 'critical'
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TARGETS / GOALS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  marketer_id UUID NOT NULL REFERENCES profiles(id),
  period TEXT NOT NULL, -- 'weekly', 'monthly'
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_leads INT DEFAULT 0,
  target_conversions INT DEFAULT 0,
  target_revenue NUMERIC(10,2) DEFAULT 0,
  set_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PERSONALIZED REMINDER LOG ─────────────────────────────────
CREATE TABLE IF NOT EXISTS personalized_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES batches(id),
  marketer_id UUID REFERENCES profiles(id),
  student_id UUID REFERENCES profiles(id),
  reminder_type TEXT NOT NULL, -- '1_week', '2_days', 'day', 'class_day'
  message_sent TEXT,
  whatsapp_status TEXT DEFAULT 'pending',
  sms_status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_alumni_published ON alumni(is_published, is_featured);
CREATE INDEX IF NOT EXISTS idx_marketer_stats_date ON marketer_daily_stats(marketer_id, stat_date DESC);
CREATE INDEX IF NOT EXISTS idx_marketer_alerts_unread ON marketer_alerts(marketer_id, is_read);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE alumni ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketer_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketer_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alumni_public_read" ON alumni FOR SELECT USING (is_published = true OR get_my_role() IN ('super_admin','project_manager','admissions_officer'));
CREATE POLICY "alumni_admin_write" ON alumni FOR ALL USING (get_my_role() IN ('super_admin','project_manager','admissions_officer'));

CREATE POLICY "stats_own_or_admin" ON marketer_daily_stats FOR SELECT
  USING (marketer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));
CREATE POLICY "stats_insert" ON marketer_daily_stats FOR INSERT WITH CHECK (marketer_id = auth.uid());
CREATE POLICY "stats_update" ON marketer_daily_stats FOR UPDATE USING (marketer_id = auth.uid());

CREATE POLICY "alerts_own" ON marketer_alerts FOR SELECT USING (marketer_id = auth.uid() OR get_my_role() IN ('super_admin','project_manager'));
CREATE POLICY "alerts_admin_insert" ON marketer_alerts FOR INSERT WITH CHECK (get_my_role() IN ('super_admin','project_manager'));

-- ── TRIGGER: auto update marketer stats when lead status changes ──
CREATE OR REPLACE FUNCTION update_marketer_stats_on_lead_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.assigned_to IS NOT NULL THEN
    INSERT INTO marketer_daily_stats (marketer_id, stat_date)
    VALUES (NEW.assigned_to, CURRENT_DATE)
    ON CONFLICT (marketer_id, stat_date) DO NOTHING;

    IF NEW.status = 'contacted' THEN
      UPDATE marketer_daily_stats SET leads_contacted = leads_contacted + 1
      WHERE marketer_id = NEW.assigned_to AND stat_date = CURRENT_DATE;
    ELSIF NEW.status = 'interested' THEN
      UPDATE marketer_daily_stats SET leads_interested = leads_interested + 1
      WHERE marketer_id = NEW.assigned_to AND stat_date = CURRENT_DATE;
    ELSIF NEW.status = 'ready_to_join' THEN
      UPDATE marketer_daily_stats SET leads_converted = leads_converted + 1
      WHERE marketer_id = NEW.assigned_to AND stat_date = CURRENT_DATE;
    ELSIF NEW.status IN ('not_interested', 'lost') THEN
      UPDATE marketer_daily_stats SET leads_lost = leads_lost + 1
      WHERE marketer_id = NEW.assigned_to AND stat_date = CURRENT_DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_marketer_stats_lead
AFTER UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION update_marketer_stats_on_lead_change();

-- Trigger when activity is logged
CREATE OR REPLACE FUNCTION update_marketer_stats_on_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO marketer_daily_stats (marketer_id, stat_date)
    VALUES (NEW.created_by, CURRENT_DATE)
    ON CONFLICT (marketer_id, stat_date) DO NOTHING;

    IF NEW.activity_type = 'call' THEN
      UPDATE marketer_daily_stats SET calls_made = calls_made + 1
      WHERE marketer_id = NEW.created_by AND stat_date = CURRENT_DATE;
    ELSIF NEW.activity_type = 'whatsapp' THEN
      UPDATE marketer_daily_stats SET whatsapp_sent = whatsapp_sent + 1
      WHERE marketer_id = NEW.created_by AND stat_date = CURRENT_DATE;
    ELSIF NEW.activity_type = 'email' THEN
      UPDATE marketer_daily_stats SET emails_sent = emails_sent + 1
      WHERE marketer_id = NEW.created_by AND stat_date = CURRENT_DATE;
    ELSIF NEW.activity_type = 'meeting' THEN
      UPDATE marketer_daily_stats SET meetings_held = meetings_held + 1
      WHERE marketer_id = NEW.created_by AND stat_date = CURRENT_DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_marketer_stats_activity
AFTER INSERT ON lead_activities
FOR EACH ROW EXECUTE FUNCTION update_marketer_stats_on_activity();

ALTER PUBLICATION supabase_realtime ADD TABLE marketer_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE alumni;
