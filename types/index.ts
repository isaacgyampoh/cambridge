export type UserRole =
  | 'super_admin' | 'project_manager' | 'marketing_officer'
  | 'admissions_officer' | 'accountant' | 'receptionist'
  | 'trainer' | 'student'

export type LeadStatus =
  | 'new' | 'contacted' | 'interested' | 'follow_up'
  | 'ready_to_join' | 'registered' | 'not_interested' | 'lost'

export type LeadSource =
  | 'facebook' | 'google' | 'linkedin' | 'website' | 'referral' | 'manual'

export type AdmissionStatus =
  | 'pending' | 'awaiting_forms' | 'awaiting_payment' | 'admitted' | 'rejected'

export type PaymentMethod = 'paystack' | 'cash' | 'bank_transfer' | 'mobile_money'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'waived'
export type ScholarshipType = 'full' | 'partial' | 'staff_discount' | 'corporate_discount'
export type ClassType = 'physical' | 'online'
export type ClassStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled'

export interface Profile {
  id: string
  full_name: string
  email: string
  phone: string | null
  role: UserRole
  avatar_url: string | null
  is_active: boolean
  marketer_code: string | null
  department: string | null
  created_at: string
  updated_at: string

  /*
   * Each member of staff can have their own WhatsApp line, so a lead is
   * messaged by the person who owns them rather than from a central number.
   * These columns exist in the database and were read by the WhatsApp screen
   * without ever being declared here.
   */
  wasender_api_key?: string | null
  wasender_status?: string | null
  wasender_phone?: string | null
  /** The greeting that line opens with. */
  wa_intro?: string | null
}

export interface Campus {
  id: string
  name: string
  city: string | null
  country: string
  address: string | null
  phone: string | null
  email: string | null
  is_active: boolean
}

export interface Course {
  id: string
  name: string
  code: string | null
  description: string | null
  duration: string | null
  course_fee: number
  course_fee_online?: number
  brochure_url?: string
  registration_fee: number
  campus_id: string | null
  is_active: boolean
}

export interface Batch {
  id: string
  name: string
  course_id: string
  campus_id: string | null
  trainer_id: string | null
  class_type: ClassType
  status: ClassStatus
  start_date: string | null
  end_date: string | null
  schedule: string | null
  venue: string | null
  zoom_link: string | null
  max_students: number
  courses?: Course
  profiles?: Profile
}

export interface Lead {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  gender: string | null
  country: string | null
  city: string | null
  source: LeadSource
  status: LeadStatus
  course_interest: string | null
  notes: string | null
  assigned_to: string | null
  assigned_by: string | null
  assigned_at: string | null
  campus_id: string | null
  fb_lead_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  created_at: string
  updated_at: string
  assignee?: Profile
  assigner?: Profile
}

export interface LeadStatusLog {
  id: string
  lead_id: string
  old_status: LeadStatus | null
  new_status: LeadStatus
  changed_by: string | null
  notes: string | null
  created_at: string
  changer?: Profile
}

export interface LeadActivity {
  id: string
  lead_id: string
  activity_type: 'call' | 'email' | 'whatsapp' | 'note' | 'meeting'
  subject: string | null
  description: string | null
  outcome: string | null
  next_follow_up: string | null
  created_by: string | null
  created_at: string
  creator?: Profile
  /* Embedded by the assignment screen: `lead:lead_id(...)`, `author:created_by(...)`. */
  lead?: EmbeddedPerson | null
  author?: EmbeddedPerson | null
}

export interface Admission {
  id: string
  lead_id: string
  student_id: string | null
  batch_id: string | null
  course_id: string
  campus_id: string | null
  status: AdmissionStatus
  assigned_officer: string | null
  admission_number: string | null
  offer_letter_sent_at: string | null
  welcome_email_sent_at: string | null
  documents_deadline: string | null
  auto_sent: boolean
  notes: string | null
  created_at: string
  updated_at: string
  lead?: Lead
  course?: Course
  batch?: Batch
  officer?: Profile
}

export interface Application {
  id: string
  marketer_id: string | null
  lead_id: string | null
  full_name: string
  email: string
  phone: string
  gender: string | null
  date_of_birth: string | null
  country: string | null
  city: string | null
  address: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  course_id: string | null
  batch_preference: string | null
  scholarship_requested: boolean
  scholarship_type: ScholarshipType | null
  scholarship_reason: string | null
  passport_photo_url: string | null
  payment_method: PaymentMethod | null
  payment_status: PaymentStatus
  paystack_ref: string | null
  paid_at: string | null
  amount_paid: number
  is_submitted: boolean
  submitted_at: string | null
  admission_id: string | null
  created_at: string
  marketer?: Profile
  course?: Course
}

/**
 * A person a record points at, as PostgREST returns an embedded row.
 *
 * Joins are requested per screen (`select: '*, student:student_id(...)'`), so
 * the relation is optional: present when it was asked for, absent when it was
 * not. Declaring it optional is what stops a screen reading `.student` from a
 * query that never selected it.
 */
export interface EmbeddedPerson {
  full_name: string
  phone?: string | null
  email?: string | null
}

export interface Payment {
  id: string
  invoice_id: string | null
  student_id: string | null
  application_id: string | null
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  paystack_ref: string | null
  receipt_number: string | null
  notes: string | null
  recorded_by: string | null
  paid_at: string | null
  created_at: string

  /** Present only when the query joined it. See EmbeddedPerson. */
  student?: EmbeddedPerson | null
}

export interface Invoice {
  id: string
  invoice_number: string
  student_id: string
  admission_id: string | null
  course_id: string | null
  total_amount: number
  amount_paid: number
  outstanding: number
  due_date: string | null
  notes: string | null
  created_at: string
  student?: Profile
}

export interface Notification {
  id: string
  user_id: string
  type: 'lead' | 'assignment' | 'admission' | 'payment' | 'reminder' | 'system'
  title: string
  body: string
  data: Record<string, any> | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

/* ─────────────────────────────────────────────
   The rest of the tables these screens read
   ─────────────────────────────────────────────

   Added because ninety screens were reading their rows as `any`, which is how
   a column that does not exist gets written without anything objecting —
   `leads.next_follow_up` was read and written here for months and every write
   failed silently.

   Fields are derived from the select clauses these tables are actually queried
   with, and from what the screens read off the rows. Nullable columns are
   marked nullable rather than assumed present: the point of doing this is to
   make the optional ones visible, not to trade one false certainty for
   another. Embedded relations are optional because they exist only when a
   query asked for them. */

export interface Alumnus {
  id: string
  full_name: string
  photo_url: string | null
  course_completed: string | null
  graduation_date: string | null
  current_job_title: string | null
  current_company: string | null
  testimonial: string | null
  is_featured: boolean
  is_published: boolean
  created_at: string
}

export interface CertificateRow {
  id: string
  enrollment_id: string | null
  student_name: string | null
  course_name: string | null
  certificate_no: string | null
  certificate_number?: string | null
  download_token: string | null
  final_url?: string | null
  month_completed: string | null
  issued: boolean
  issued_at: string | null
  issued_date?: string | null
  created_at?: string
}

export interface ClassSession {
  id: string
  batch_id: string | null
  session_date: string
  class_code: string | null
  signin_open: boolean
  total_signed_in?: number | null
  total_paid?: number | null
  created_at: string
  /** Present when the query embedded it. */
  batches?: { name: string; courses?: { name: string } | null } | null
}

export interface ClassSignin {
  id: string
  session_id: string | null
  full_name: string | null
  phone: string | null
  attendance_type: string | null
  code_verified: boolean | null
  payment_status: string | null
  payment_method: string | null
  amount_paid: number | null
  created_at: string
  marketer?: EmbeddedPerson | null
}

export interface ClassEnrollment {
  id: string
  batch_id: string | null
  student_id: string | null
  full_name?: string | null
  status?: string | null
  created_at?: string
  batch?: { name: string; course?: { name: string } | null } | null
}

export interface AiConversation {
  id: string
  /* The number the message arrived from. Present even when no lead matched
     it, which is exactly the case the conversations screen groups by. */
  phone: string | null
  lead_id: string | null
  marketer_id: string | null
  created_at: string
  lead?: {
    full_name: string
    status?: string | null
    phone?: string | null
    assigned_to?: string | null
  } | null
  marketer?: EmbeddedPerson | null
}

export interface KnowledgeEntry {
  id: string
  kind: string | null
  category: string | null
  question: string
  answer: string
  is_active: boolean
  created_at?: string
}

export interface Sequence {
  id: string
  name: string
  trigger: string | null
  is_active: boolean
  created_at?: string
}

export interface SequenceStep {
  id: string
  sequence_id: string
  message: string
  /** Hours after the trigger, or after the previous step. */
  delay_hours?: number | null
  step_order?: number | null
}

export interface ProgramPoints {
  id?: string
  code: string
  name: string
  points: number
  is_corporate: boolean | null
}

export interface RankBand {
  id: string
  name: string
  min_points: number
  max_points: number | null
  gross_salary: number
}

export interface OfficeLocation {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_meters: number
  is_active: boolean
}

export interface StaffAttendance {
  id: string
  staff_id?: string | null
  clock_in_at: string | null
  clock_out_at: string | null
  distance_meters: number | null
  status: string | null
  staff?: EmbeddedPerson | null
}

export interface Testimonial {
  id: string
  student_name: string | null
  program_name: string | null
  role_title: string | null
  quote: string | null
  image_url: string | null
  approved: boolean
  shared: boolean
  created_at?: string
}

export interface StudentFee {
  id: string
  lead_id: string | null
  course_id: string | null
  student_name: string | null
  course_name: string | null
  phone: string | null
  total_fee: number
  amount_paid: number
  balance: number
  status: string | null
  delivery?: string | null
  created_at?: string
  updated_at?: string
}

/**
 * One scheduled job, and how its last run went.
 *
 * A row per task rather than per run: the columns are `last_*`, so this is the
 * job's current state, not a history.
 */
export interface CronRun {
  id: string
  task: string | null
  last_status: string | null
  last_run_at: string | null
  last_detail: string | null
  created_at?: string
}

export interface DocumentRow {
  id: string
  name: string
  type: string | null
  description: string | null
  file_url: string
  file_name: string | null
  course_id: string | null
  is_active: boolean
  is_template: boolean | null
  created_at: string
  courses?: { name: string } | null
}
