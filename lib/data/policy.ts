import 'server-only'

/**
 * Access policy for the generic /api/data endpoint.
 *
 * That endpoint runs client-supplied table names, select strings and filters
 * with the service role, which bypasses Row Level Security entirely. It is not
 * a shape that can be made safe in the long run — the plan is to replace it
 * with typed per-resource endpoints — but until then every request through it
 * has to be checked here.
 *
 * Three separate things are enforced:
 *   1. READ / WRITE / DELETE table allowlists, per role.
 *   2. A column denylist, so credentials can never be read or written.
 *   3. Row scoping, so a role that may read a table still only sees its own
 *      rows where that is the intent.
 */

export const ALL_TABLES_WILDCARD = '*'

/** Tables each role may SELECT. Preserved from the original endpoint. */
export const READ_TABLES: Record<string, string[]> = {
  super_admin: [ALL_TABLES_WILDCARD],
  administrator: [ALL_TABLES_WILDCARD],
  exam_coordinator: ['leads','lead_activities','lead_comments','lead_status_logs','documents','prep_records','testimonials','class_enrollments','profiles','courses','batches','notifications','staff_attendance','office_locations'],
  project_manager: ['documents','leads','lead_activities','lead_status_logs','profiles','notifications','admissions','batches','courses','class_enrollments','class_materials','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','program_points','rank_bands','marketer_enrollments'],
  marketing_officer: ['leads','lead_activities','lead_status_logs','notifications','follow_up_queue','applications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','program_points','rank_bands','marketer_enrollments','profiles','courses'],
  admissions_officer: ['admissions','applications','leads','profiles','courses','batches','notifications','staff_attendance','office_locations','knowledge_base','ai_conversations'],
  accountant: ['payments','invoices','applications','profiles','courses','notifications','marketer_enrollments','leads','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','program_points','rank_bands'],
  receptionist: ['batches','batch_students','profiles','courses','class_sessions','class_signins','notifications','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','program_points','rank_bands','marketer_enrollments'],
  trainer: ['leads','lead_activities','lead_comments','lead_status_logs','documents','batches','batch_students','attendance','profiles','courses','class_sessions','staff_attendance','office_locations','knowledge_base','ai_conversations','sequences','sequence_steps','sequence_enrollments','program_points','rank_bands','marketer_enrollments'],
  content_manager: ['profiles','courses','notifications','staff_attendance','office_locations','knowledge_base'],
  student: ['invoices','payments','batch_students','batches','courses','attendance','notifications'],
}

/**
 * Tables each role may INSERT into or UPDATE.
 *
 * Previously there was NO allowlist at all on POST or PATCH — only DELETE had
 * one. Any signed-in user, a student included, could PATCH the profiles table
 * and set their own role to super_admin. These lists are drawn from what the
 * application actually writes through this endpoint.
 */
export const WRITE_TABLES: Record<string, string[]> = {
  super_admin: [ALL_TABLES_WILDCARD],
  administrator: ['leads','lead_activities','lead_comments','follow_up_queue','admissions','applications','courses','batches','class_sessions','class_signins','attendance','documents','alumni','knowledge_base','sequences','sequence_steps','testimonials','notifications','office_locations','program_points'],
  project_manager: ['leads','lead_activities','lead_comments','lead_status_logs','follow_up_queue','admissions','documents','batches','courses','class_enrollments','class_sessions','knowledge_base','sequences','sequence_steps','sequence_enrollments','notifications','program_points','alumni'],
  marketing_officer: ['leads','lead_activities','lead_comments','lead_status_logs','follow_up_queue','notifications'],
  admissions_officer: ['admissions','applications','leads','lead_activities','batches','notifications'],
  accountant: ['payments','invoices','applications','notifications','program_points'],
  receptionist: ['class_sessions','class_signins','batch_students','attendance','notifications'],
  trainer: ['attendance','class_sessions','lead_activities','lead_comments','notifications','documents'],
  exam_coordinator: ['prep_records','testimonials','documents','lead_activities','lead_comments','notifications'],
  content_manager: ['knowledge_base','notifications'],
  student: [],
}

/** Tables each role may DELETE from. Deliberately narrower than write. */
export const DELETE_TABLES: Record<string, string[]> = {
  super_admin: [ALL_TABLES_WILDCARD],
  administrator: ['lead_activities','lead_comments','documents','alumni','knowledge_base','sequences','sequence_steps','testimonials'],
  project_manager: ['lead_activities','lead_comments','documents','knowledge_base','sequences','sequence_steps','alumni'],
  marketing_officer: ['lead_activities','lead_comments'],
  admissions_officer: [],
  accountant: [],
  receptionist: ['class_signins'],
  trainer: ['lead_activities','lead_comments'],
  exam_coordinator: ['testimonials','prep_records'],
  content_manager: ['knowledge_base'],
  student: [],
}

/**
 * Columns that must never leave the server, whatever the role.
 *
 * The original scrubber only ran for roles that could NOT see money, so the
 * four roles that could — super admin, accountant, marketing officer, project
 * manager — received `pin_hash` in the JSON for every profile they read. With
 * a fast, globally-salted hash over a four-digit PIN, that is every
 * colleague's PIN.
 */
export const SECRET_COLUMNS = [
  'pin_hash', 'otp_code', 'otp_expires_at', 'otp_attempts',
  'recovery_pin_hash', 'reset_token_hash', 'reset_token_expires_at',
  'session_token', 'wasender_api_key', 'wawp_access_token',
  'api_key', 'access_token', 'secret', 'password',
]

/** Money columns, hidden from roles with no financial remit. */
export const MONEY_COLUMNS = [
  'amount', 'amount_paid', 'registration_fee', 'gross_salary',
  'total_amount', 'outstanding', 'paystack_response',
]

export const ROLES_THAT_SEE_MONEY = ['super_admin', 'administrator', 'accountant', 'marketing_officer', 'project_manager']

/**
 * Columns that may never be SET through the generic endpoint, whatever the
 * table or role. Anything that grants access or represents a credential has
 * to go through a dedicated, audited route instead.
 */
export const UNWRITABLE_COLUMNS = [
  'id', 'created_at',
  'role', 'portals', 'is_active', 'permissions',
  'pin_hash', 'pin_set_at', 'must_change_pin', 'login_attempts', 'locked_until',
  // Recovery credentials (migration 0015). Enumerated explicitly rather than
  // trusted to a pattern match, because this list is what actually enforces it.
  'recovery_pin_hash', 'recovery_pin_set_at', 'reset_token_hash', 'reset_token_expires_at',
  'otp_code', 'otp_expires_at', 'otp_attempts',
  'session_token', 'marketer_code',
  'wasender_api_key', 'wawp_access_token',
]

/**
 * Row scoping: a role may reach the table, but only its own rows.
 * Returns the column that must equal the current user's id, or null.
 */
export function ownerColumnFor(table: string, role: string): string | null {
  if (role === 'super_admin' || role === 'administrator') return null

  // Anyone with a "my leads" view sees only leads assigned to them.
  const ownLeadsOnly = ['marketing_officer', 'exam_coordinator', 'trainer', 'content_manager']
  if (table === 'leads' && ownLeadsOnly.includes(role)) return 'assigned_to'

  // Only oversight roles read other people's staff records.
  const canReadAllProfiles = ['project_manager', 'accountant', 'admissions_officer']
  if (table === 'profiles' && !canReadAllProfiles.includes(role)) return 'id'

  if (table === 'notifications') return 'user_id'

  /*
   * Students were allowed `payments` and `invoices` with no owner filter at
   * all, so any student could read every payment and invoice in the school.
   */
  if (role === 'student') {
    if (table === 'payments' || table === 'invoices') return 'student_id'
    if (table === 'batch_students' || table === 'attendance') return 'student_id'
  }

  return null
}

export function canRead(table: string, role: string): boolean {
  const list = READ_TABLES[role] || []
  return list.includes(ALL_TABLES_WILDCARD) || list.includes(table)
}

export function canWrite(table: string, role: string): boolean {
  const list = WRITE_TABLES[role] || []
  return list.includes(ALL_TABLES_WILDCARD) || list.includes(table)
}

export function canDelete(table: string, role: string): boolean {
  const list = DELETE_TABLES[role] || []
  return list.includes(ALL_TABLES_WILDCARD) || list.includes(table)
}

/** A table name must be a plain identifier — never anything else. */
export function isValidIdentifier(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name)
}

/**
 * Pull the relations a PostgREST `select` string embeds.
 *
 * This is the hole that made the table allowlist decorative: the allowlist
 * checked only the table NAMED in `table=`, while `select` can pull in related
 * tables through a foreign key — `?table=batch_students&select=*,profiles(*)`
 * reached profiles without profiles ever being checked.
 *
 * Both spellings are recognised: a bare `relation(...)` and the aliased
 * `alias:relation(...)` form.
 */
export function embeddedRelations(select: string): string[] {
  const found = new Set<string>()
  const re = /(?:^|[,(\s])(?:([a-z_][a-z0-9_]*)\s*:\s*)?([a-z_][a-z0-9_]*)\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(select)) !== null) {
    // m[2] is the relation (or the FK column it is resolved through).
    found.add(m[2].toLowerCase())
  }
  return [...found]
}

/**
 * Foreign-key columns whose embed target is a sensitive table, so that
 * `student:student_id(...)` is understood to reach `profiles`.
 */
export const FK_TARGETS: Record<string, string> = {
  student_id: 'profiles',
  assigned_to: 'profiles',
  marketer_id: 'profiles',
  user_id: 'profiles',
  created_by: 'profiles',
  actor_id: 'profiles',
  trainer_id: 'profiles',
  lead_id: 'leads',
  course_id: 'courses',
  batch_id: 'batches',
}

/** Recursively strip forbidden columns from a result row or nested embed. */
export function scrubRow(value: unknown, columns: string[]): unknown {
  if (Array.isArray(value)) return value.map(v => scrubRow(v, columns))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (columns.includes(k)) {
        // Keep the useful signal without the secret itself.
        if (k === 'wasender_api_key') out.has_wasender_key = Boolean(v)
        continue
      }
      out[k] = (v && typeof v === 'object') ? scrubRow(v, columns) : v
    }
    return out
  }
  return value
}
