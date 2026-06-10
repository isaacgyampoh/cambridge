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
