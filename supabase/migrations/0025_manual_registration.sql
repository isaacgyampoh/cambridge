-- Registering a student who never went through the portal.
--
-- Academic staff sign students up at the desk. Those students must end up in
-- the SAME records an online registration produces — applications, leads,
-- admissions, student_fees — because that chain is what the accountant's
-- screen, the class roster and the fee ledger all read. Two things in the
-- schema stood in the way.

-- 1. An application demanded an email address.
--
-- A student signed up at the desk frequently has no email. The alternative to
-- this change is storing something invented to satisfy the column, which puts
-- a real message somewhere it cannot arrive. The phone number is the identity
-- every message route in this portal actually uses, and it stays required in
-- the application layer.
--
-- Only the NOT NULL is removed. Every existing row keeps its address, and the
-- online form still always sends one.
ALTER TABLE applications ALTER COLUMN email DROP NOT NULL;

-- 2. Nothing recorded HOW a registration arrived.
--
-- leads.source already carries 'manual' in its enum, but a lead is not the
-- right place for this: a student may have arrived from Facebook months ago
-- and be registered at the desk today, and overwriting their real source to
-- say so would lose where they came from. The fact belongs to the
-- registration, not the person.
--
-- Defaulted to 'online' so every row already present reads as what it was.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS registration_source TEXT DEFAULT 'online';

COMMENT ON COLUMN applications.registration_source IS
  'How the registration was made: ''online'' through the portal, ''manual'' by academic staff.';

-- The accountant and the academic list both filter on it.
CREATE INDEX IF NOT EXISTS idx_applications_registration_source
  ON applications (registration_source);

-- Existing rows are online registrations by definition: manual registration
-- did not exist before this migration.
UPDATE applications SET registration_source = 'online' WHERE registration_source IS NULL;
