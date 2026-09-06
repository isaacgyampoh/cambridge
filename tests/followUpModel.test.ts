import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

/**
 * FOLLOW-UP DATA MODEL — ONE AUTHORITATIVE SOURCE.
 *
 * ── THE SPLIT BRAIN THIS PREVENTS ──────────────────────────────────────────
 *
 * A follow-up date could live in three places, and which one it landed in
 * depended on which screen was used:
 *
 *   leads.follow_up_at              written by the leads list and the WhatsApp
 *                                   webhook; read by the leads list, the lead
 *                                   detail header and the dashboard counts
 *
 *   follow_up_queue                 written by the lead detail page; read by
 *                                   /marketer/activities, which IS the
 *                                   Follow-ups screen
 *
 *   lead_activities.next_follow_up  written and read only by the activity
 *                                   timeline
 *
 * So a follow-up set on the lead detail page never appeared in the overdue
 * banner or on the dashboard, and one set from the leads list never appeared
 * on the Follow-ups screen. Neither view showed the whole picture, and each
 * looked authoritative to whoever was using it.
 *
 * Migration 0014 settles it:
 *
 *   follow_up_queue    the record of follow-up WORK, with the lifecycle a
 *                      single date column cannot express. EVERY write goes
 *                      here.
 *
 *   leads.follow_up_at DERIVED — the earliest pending queue row for that lead,
 *                      maintained by trigger trg_sync_lead_follow_up and
 *                      written by NO application code. It exists so the leads
 *                      list and dashboard can filter without an aggregate join
 *                      per row. Indexed: idx_leads_follow_up_at.
 *
 *   lead_activities.next_follow_up  a historical note of what was intended
 *                      when an activity was logged. A log entry, not a
 *                      schedule.
 *
 * The trigger's four transitions were verified against production inside
 * transactions that were rolled back: insert mirrors, completing clears,
 * snoozing moves, deleting nulls, and the earliest of two pending rows wins.
 *
 * This test guards the half that can drift in code: that nothing starts
 * writing the derived column again.
 */

const sourceFiles = execSync(
  "find app lib components -name '*.ts' -o -name '*.tsx'",
  { encoding: 'utf8', cwd: process.cwd() }
).trim().split('\n').filter(Boolean)

describe('leads.follow_up_at is derived, and no code writes it', () => {
  test('no source file writes follow_up_at onto the leads table', () => {
    const offenders: string[] = []

    for (const file of sourceFiles) {
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        // A write is a mutate/update carrying follow_up_at that is NOT aimed
        // at follow_up_queue. Comments are ignored.
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return
        if (!/follow_up_at/.test(line)) return
        if (/follow_up_queue/.test(line)) return

        const isWrite =
          /mutate\(\s*'PATCH'\s*,\s*'leads'/.test(line) ||
          /from\('leads'\)[\s\S]{0,40}\.update\(/.test(line) ||
          /update\.follow_up_at\s*=/.test(line)

        if (isWrite) offenders.push(`${file}:${i + 1}  ${trimmed.slice(0, 100)}`)
      })
    }

    assert.deepEqual(offenders, [],
      'these write the derived column directly instead of the queue:\n' + offenders.join('\n'))
  })

  test('the trigger and its index are declared in a migration', () => {
    const migration = readFileSync('supabase/migrations/0014_follow_up_single_source.sql', 'utf8')
    assert.match(migration, /CREATE OR REPLACE FUNCTION sync_lead_follow_up/)
    assert.match(migration, /CREATE TRIGGER trg_sync_lead_follow_up/)
    assert.match(migration, /AFTER INSERT OR UPDATE OR DELETE ON follow_up_queue/)
    assert.match(migration, /idx_leads_follow_up_at/)
    // The backfill must exist, or follow-ups scheduled before the change are
    // silently dropped from the queue.
    assert.match(migration, /INSERT INTO follow_up_queue[\s\S]*FROM leads/)
  })

  test('the migration relaxes marketer_id, so an unowned lead can have one', () => {
    const migration = readFileSync('supabase/migrations/0014_follow_up_single_source.sql', 'utf8')
    assert.match(migration, /ALTER TABLE follow_up_queue ALTER COLUMN marketer_id DROP NOT NULL/)
  })
})

describe('the write paths all target the queue', () => {
  const writers = [
    'app/(portal)/marketer/leads/page.tsx',
    'app/(portal)/marketer/leads/[id]/page.tsx',
    'app/api/webhooks/whatsapp/route.ts',
  ]

  for (const file of writers) {
    test(`${file} schedules follow-ups through follow_up_queue`, () => {
      const src = readFileSync(file, 'utf8')
      assert.match(src, /follow_up_queue/,
        'this file schedules a follow-up but does not mention the queue')
    })
  }
})
