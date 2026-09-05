-- ============================================================================
-- 0006 — INDEX EVERY FOREIGN KEY
--
-- Run AFTER 0005. Purely additive: creates 115 indexes across 64 tables and
-- changes nothing else. Idempotent — every statement is IF NOT EXISTS — and
-- not destructive.
--
-- WHY
--
-- Postgres indexes the TARGET of a foreign key automatically, because that is
-- a primary key. It does not index the column holding the reference. So every
-- join from the child side, and every "find the rows belonging to this
-- parent" lookup, is a sequential scan. An audit of the live database found
-- 115 such keys across 64 tables.
--
-- At today's volumes — 181 leads, 18 staff, 29 MB — this costs nothing you can
-- measure. It is what makes a dashboard that is instant now take seconds at
-- ten thousand leads.
--
-- ── ON LOCKING ─────────────────────────────────────────────────────────────
--
-- These are plain CREATE INDEX statements, so each takes a brief lock against
-- writes to its table while it builds. That is deliberate: on tables this size
-- the build is measured in milliseconds, and a plain statement can run inside
-- a transaction, so the whole migration either applies or does not.
--
-- If you run this again in a year when the tables are large, swap CREATE INDEX
-- for CREATE INDEX CONCURRENTLY and REMOVE the BEGIN/COMMIT below —
-- CONCURRENTLY cannot run inside a transaction block. It takes no write lock,
-- but a failed build leaves an INVALID index behind, which you find with:
--     SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- ============================================================================

BEGIN;


-- admissions (5 keys)
CREATE INDEX IF NOT EXISTS idx_admissions_assigned_officer ON public.admissions (assigned_officer);
CREATE INDEX IF NOT EXISTS idx_admissions_batch_id ON public.admissions (batch_id);
CREATE INDEX IF NOT EXISTS idx_admissions_campus_id ON public.admissions (campus_id);
CREATE INDEX IF NOT EXISTS idx_admissions_course_id ON public.admissions (course_id);
CREATE INDEX IF NOT EXISTS idx_admissions_student_id ON public.admissions (student_id);

-- ai_conversations (2 keys)
CREATE INDEX IF NOT EXISTS idx_ai_conversations_lead_id ON public.ai_conversations (lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_marketer_id ON public.ai_conversations (marketer_id);

-- alumni (2 keys)
CREATE INDEX IF NOT EXISTS idx_alumni_added_by ON public.alumni (added_by);
CREATE INDEX IF NOT EXISTS idx_alumni_student_id ON public.alumni (student_id);

-- applications (2 keys)
CREATE INDEX IF NOT EXISTS idx_applications_admission_id ON public.applications (admission_id);
CREATE INDEX IF NOT EXISTS idx_applications_lead_id ON public.applications (lead_id);

-- attendance (2 keys)
CREATE INDEX IF NOT EXISTS idx_attendance_recorded_by ON public.attendance (recorded_by);
CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON public.attendance (student_id);

-- audit_logs (1 key)
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs (user_id);

-- batch_students (1 key)
CREATE INDEX IF NOT EXISTS idx_batch_students_student_id ON public.batch_students (student_id);

-- batches (3 keys)
CREATE INDEX IF NOT EXISTS idx_batches_campus_id ON public.batches (campus_id);
CREATE INDEX IF NOT EXISTS idx_batches_course_id ON public.batches (course_id);
CREATE INDEX IF NOT EXISTS idx_batches_trainer_id ON public.batches (trainer_id);

-- brand_assets (1 key)
CREATE INDEX IF NOT EXISTS idx_brand_assets_created_by ON public.brand_assets (created_by);

-- brand_profile (1 key)
CREATE INDEX IF NOT EXISTS idx_brand_profile_updated_by ON public.brand_profile (updated_by);

-- broadcast_recipients (1 key)
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_id ON public.broadcast_recipients (broadcast_id);

-- broadcasts (1 key)
CREATE INDEX IF NOT EXISTS idx_broadcasts_created_by ON public.broadcasts (created_by);

-- certificates (6 keys)
CREATE INDEX IF NOT EXISTS idx_certificates_admission_id ON public.certificates (admission_id);
CREATE INDEX IF NOT EXISTS idx_certificates_batch_id ON public.certificates (batch_id);
CREATE INDEX IF NOT EXISTS idx_certificates_course_id ON public.certificates (course_id);
CREATE INDEX IF NOT EXISTS idx_certificates_enrollment_id ON public.certificates (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_certificates_issued_by ON public.certificates (issued_by);
CREATE INDEX IF NOT EXISTS idx_certificates_student_id ON public.certificates (student_id);

-- class_enrollments (2 keys)
CREATE INDEX IF NOT EXISTS idx_class_enrollments_application_id ON public.class_enrollments (application_id);
CREATE INDEX IF NOT EXISTS idx_class_enrollments_lead_id ON public.class_enrollments (lead_id);

-- class_materials (2 keys)
CREATE INDEX IF NOT EXISTS idx_class_materials_batch_id ON public.class_materials (batch_id);
CREATE INDEX IF NOT EXISTS idx_class_materials_sent_by ON public.class_materials (sent_by);

-- class_payments (3 keys)
CREATE INDEX IF NOT EXISTS idx_class_payments_batch_id ON public.class_payments (batch_id);
CREATE INDEX IF NOT EXISTS idx_class_payments_enrollment_id ON public.class_payments (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_class_payments_verified_by ON public.class_payments (verified_by);

-- class_reminders (2 keys)
CREATE INDEX IF NOT EXISTS idx_class_reminders_batch_id ON public.class_reminders (batch_id);
CREATE INDEX IF NOT EXISTS idx_class_reminders_created_by ON public.class_reminders (created_by);

-- class_sessions (1 key)
CREATE INDEX IF NOT EXISTS idx_class_sessions_created_by ON public.class_sessions (created_by);

-- class_signins (3 keys)
CREATE INDEX IF NOT EXISTS idx_class_signins_batch_id ON public.class_signins (batch_id);
CREATE INDEX IF NOT EXISTS idx_class_signins_marketer_id ON public.class_signins (marketer_id);
CREATE INDEX IF NOT EXISTS idx_class_signins_student_id ON public.class_signins (student_id);

-- competitors (1 key)
CREATE INDEX IF NOT EXISTS idx_competitors_added_by ON public.competitors (added_by);

-- content_calendar (1 key)
CREATE INDEX IF NOT EXISTS idx_content_calendar_created_by ON public.content_calendar (created_by);

-- content_posts (1 key)
CREATE INDEX IF NOT EXISTS idx_content_posts_created_by ON public.content_posts (created_by);

-- courses (1 key)
CREATE INDEX IF NOT EXISTS idx_courses_campus_id ON public.courses (campus_id);

-- deferrals (1 key)
CREATE INDEX IF NOT EXISTS idx_deferrals_deferred_by ON public.deferrals (deferred_by);

-- documents (1 key)
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON public.documents (uploaded_by);

-- external_signins (1 key)
CREATE INDEX IF NOT EXISTS idx_external_signins_matched_lead_id ON public.external_signins (matched_lead_id);

-- fee_payments (2 keys)
CREATE INDEX IF NOT EXISTS idx_fee_payments_application_id ON public.fee_payments (application_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_verified_by ON public.fee_payments (verified_by);

-- follow_up_queue (1 key)
CREATE INDEX IF NOT EXISTS idx_follow_up_queue_lead_id ON public.follow_up_queue (lead_id);

-- info_session_joins (1 key)
CREATE INDEX IF NOT EXISTS idx_info_session_joins_lead_id ON public.info_session_joins (lead_id);

-- info_sessions (1 key)
CREATE INDEX IF NOT EXISTS idx_info_sessions_created_by ON public.info_sessions (created_by);

-- invoices (5 keys)
CREATE INDEX IF NOT EXISTS idx_invoices_admission_id ON public.invoices (admission_id);
CREATE INDEX IF NOT EXISTS idx_invoices_campus_id ON public.invoices (campus_id);
CREATE INDEX IF NOT EXISTS idx_invoices_course_id ON public.invoices (course_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON public.invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_student_id ON public.invoices (student_id);

-- lead_activities (2 keys)
CREATE INDEX IF NOT EXISTS idx_lead_activities_created_by ON public.lead_activities (created_by);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON public.lead_activities (lead_id);

-- lead_comments (1 key)
CREATE INDEX IF NOT EXISTS idx_lead_comments_author_id ON public.lead_comments (author_id);

-- lead_status_logs (1 key)
CREATE INDEX IF NOT EXISTS idx_lead_status_logs_changed_by ON public.lead_status_logs (changed_by);

-- lead_transfer_requests (3 keys)
CREATE INDEX IF NOT EXISTS idx_lead_transfer_requests_current_owner ON public.lead_transfer_requests (current_owner);
CREATE INDEX IF NOT EXISTS idx_lead_transfer_requests_decided_by ON public.lead_transfer_requests (decided_by);
CREATE INDEX IF NOT EXISTS idx_lead_transfer_requests_requested_by ON public.lead_transfer_requests (requested_by);

-- leads (3 keys)
CREATE INDEX IF NOT EXISTS idx_leads_assigned_by ON public.leads (assigned_by);
CREATE INDEX IF NOT EXISTS idx_leads_campus_id ON public.leads (campus_id);
CREATE INDEX IF NOT EXISTS idx_leads_referrer_id ON public.leads (referrer_id);

-- login_events (1 key)
CREATE INDEX IF NOT EXISTS idx_login_events_user_id ON public.login_events (user_id);

-- marketer_alerts (1 key)
CREATE INDEX IF NOT EXISTS idx_marketer_alerts_marketer_id ON public.marketer_alerts (marketer_id);

-- marketer_enrollments (2 keys)
CREATE INDEX IF NOT EXISTS idx_marketer_enrollments_commission_paid_by ON public.marketer_enrollments (commission_paid_by);
CREATE INDEX IF NOT EXISTS idx_marketer_enrollments_created_by ON public.marketer_enrollments (created_by);

-- marketer_targets (2 keys)
CREATE INDEX IF NOT EXISTS idx_marketer_targets_marketer_id ON public.marketer_targets (marketer_id);
CREATE INDEX IF NOT EXISTS idx_marketer_targets_set_by ON public.marketer_targets (set_by);

-- material_releases (1 key)
CREATE INDEX IF NOT EXISTS idx_material_releases_document_id ON public.material_releases (document_id);

-- payment_reminders (2 keys)
CREATE INDEX IF NOT EXISTS idx_payment_reminders_invoice_id ON public.payment_reminders (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_student_id ON public.payment_reminders (student_id);

-- payments (3 keys)
CREATE INDEX IF NOT EXISTS idx_payments_application_id ON public.payments (application_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON public.payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_recorded_by ON public.payments (recorded_by);

-- personalized_reminders (3 keys)
CREATE INDEX IF NOT EXISTS idx_personalized_reminders_batch_id ON public.personalized_reminders (batch_id);
CREATE INDEX IF NOT EXISTS idx_personalized_reminders_marketer_id ON public.personalized_reminders (marketer_id);
CREATE INDEX IF NOT EXISTS idx_personalized_reminders_student_id ON public.personalized_reminders (student_id);

-- pipeline_events (2 keys)
CREATE INDEX IF NOT EXISTS idx_pipeline_events_created_by ON public.pipeline_events (created_by);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_lead_id ON public.pipeline_events (lead_id);

-- prep_activity (2 keys)
CREATE INDEX IF NOT EXISTS idx_prep_activity_actor_id ON public.prep_activity (actor_id);
CREATE INDEX IF NOT EXISTS idx_prep_activity_prep_record_id ON public.prep_activity (prep_record_id);

-- prep_content (1 key)
CREATE INDEX IF NOT EXISTS idx_prep_content_created_by ON public.prep_content (created_by);

-- prep_records (3 keys)
CREATE INDEX IF NOT EXISTS idx_prep_records_application_id ON public.prep_records (application_id);
CREATE INDEX IF NOT EXISTS idx_prep_records_enrollment_id ON public.prep_records (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_prep_records_lead_id ON public.prep_records (lead_id);

-- prep_sends (1 key)
CREATE INDEX IF NOT EXISTS idx_prep_sends_prep_record_id ON public.prep_sends (prep_record_id);

-- profiles (1 key)
CREATE INDEX IF NOT EXISTS idx_profiles_reports_to ON public.profiles (reports_to);

-- referral_codes (1 key)
CREATE INDEX IF NOT EXISTS idx_referral_codes_referrer_profile_id ON public.referral_codes (referrer_profile_id);

-- referrals (2 keys)
CREATE INDEX IF NOT EXISTS idx_referrals_referred_lead_id ON public.referrals (referred_lead_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON public.referrals (referrer_id);

-- scheduled_tasks (1 key)
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_created_by ON public.scheduled_tasks (created_by);

-- scholarships (3 keys)
CREATE INDEX IF NOT EXISTS idx_scholarships_application_id ON public.scholarships (application_id);
CREATE INDEX IF NOT EXISTS idx_scholarships_approved_by ON public.scholarships (approved_by);
CREATE INDEX IF NOT EXISTS idx_scholarships_student_id ON public.scholarships (student_id);

-- sequence_enrollments (1 key)
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_lead_id ON public.sequence_enrollments (lead_id);

-- sequence_steps (1 key)
CREATE INDEX IF NOT EXISTS idx_sequence_steps_sequence_id ON public.sequence_steps (sequence_id);

-- shared_links (2 keys)
CREATE INDEX IF NOT EXISTS idx_shared_links_batch_id ON public.shared_links (batch_id);
CREATE INDEX IF NOT EXISTS idx_shared_links_posted_by ON public.shared_links (posted_by);

-- staff_attendance (1 key)
CREATE INDEX IF NOT EXISTS idx_staff_attendance_office_id ON public.staff_attendance (office_id);

-- staff_invites (1 key)
CREATE INDEX IF NOT EXISTS idx_staff_invites_created_by ON public.staff_invites (created_by);

-- student_fees (3 keys)
CREATE INDEX IF NOT EXISTS idx_student_fees_admission_id ON public.student_fees (admission_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_course_id ON public.student_fees (course_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_lead_id ON public.student_fees (lead_id);

-- student_sessions (1 key)
CREATE INDEX IF NOT EXISTS idx_student_sessions_lead_id ON public.student_sessions (lead_id);

-- testimonials (1 key)
CREATE INDEX IF NOT EXISTS idx_testimonials_collected_by ON public.testimonials (collected_by);

-- voucher_requests (3 keys)
CREATE INDEX IF NOT EXISTS idx_voucher_requests_fulfilled_by ON public.voucher_requests (fulfilled_by);
CREATE INDEX IF NOT EXISTS idx_voucher_requests_prep_record_id ON public.voucher_requests (prep_record_id);
CREATE INDEX IF NOT EXISTS idx_voucher_requests_requested_by ON public.voucher_requests (requested_by);

-- whatsapp_inbox (1 key)
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbox_lead_id ON public.whatsapp_inbox (lead_id);

COMMIT;

-- ============================================================================
-- AFTER RUNNING THIS
--
--   Confirm none are left — expected 0:
--     SELECT count(*) FROM pg_constraint c
--       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
--      WHERE c.contype='f' AND c.connamespace='public'::regnamespace
--        AND NOT EXISTS (SELECT 1 FROM pg_index i
--                         WHERE i.indrelid=c.conrelid AND a.attnum=i.indkey[0]);
-- ============================================================================
