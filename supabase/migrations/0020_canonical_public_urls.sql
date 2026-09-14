-- ============================================================================
-- 0020 — STORED LINKS NAME THE CENTRE, NOT A DEPLOYMENT
--
-- Run AFTER 0019. Data only: no table, column, index or policy changes.
--
-- WHY
--
-- The brochure links on the public front page read
--
--     https://cambridge-mu.vercel.app/brochures/pmp-brochure.pdf
--
-- No code builds those. They are stored absolute, written while
-- NEXT_PUBLIC_APP_URL pointed at a deployment alias — so fixing the code could
-- not reach them, because the code was never what produced them.
--
-- A marketer shares a brochure with a customer and it carries an address that
-- says nothing about Cambridge, works only while that alias happens to exist,
-- and looks exactly like the kind of link people are told not to open.
--
-- WHAT IS CHANGED, AND WHAT IS NOT
--
-- Only the ORIGIN, and only when it is this application under another name: a
-- *.vercel.app deployment, or a localhost address written by a developer's
-- build. The path, query and fragment are preserved exactly.
--
-- Cloudinary, Supabase storage and every other genuine third-party host are
-- left completely alone. They are not this application and their addresses are
-- correct.
--
-- SAFETY
--
-- The application does not depend on this migration. canonicalisePublicUrl in
-- lib/url.ts already repairs these on the way out, so every link is correct
-- whether or not this has been run. This makes the stored data match what is
-- being served, so the next person to read the table is not misled.
--
-- Idempotent: running it twice changes nothing the second time, because the
-- rows no longer match the WHERE clause.
-- ============================================================================

BEGIN;

-- Course brochures — the ones on the public front page.
UPDATE courses
SET brochure_url = 'https://portal.cambridge.edu.gh'
  || regexp_replace(brochure_url, '^https?://[^/]+', '')
WHERE brochure_url ~ '^https?://([^/]*\.)?vercel\.app/'
   OR brochure_url ~ '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/';

-- Flyer artwork. Most is on Cloudinary and is untouched by the WHERE clause;
-- anything uploaded to the application's own public folder is not.
UPDATE flyers
SET image_url = 'https://portal.cambridge.edu.gh'
  || regexp_replace(image_url, '^https?://[^/]+', '')
WHERE image_url ~ '^https?://([^/]*\.)?vercel\.app/'
   OR image_url ~ '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/';

-- Documents: admission letters, certificates, brochures sent on WhatsApp.
UPDATE documents
SET file_url = 'https://portal.cambridge.edu.gh'
  || regexp_replace(file_url, '^https?://[^/]+', '')
WHERE file_url ~ '^https?://([^/]*\.)?vercel\.app/'
   OR file_url ~ '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/';

COMMIT;
