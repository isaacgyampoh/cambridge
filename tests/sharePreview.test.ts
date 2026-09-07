import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

/**
 * A SHARED LINK MUST LOOK LIKE SOMETHING.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * Every platform that renders a link preview — WhatsApp, Facebook, LinkedIn,
 * X, Telegram — fetches the URL with a crawler that does NOT run JavaScript.
 *
 * Every public page in this product was a client component. /f/[id], the
 * flyer link a marketer shares, fetched its own flyer from the browser, so a
 * crawler received an empty shell and fell back to the root layout: the crest
 * at 512px and the site's generic description.
 *
 * The consequence is the whole reason people paste a screenshot of a flyer
 * into a WhatsApp group instead of a link. A screenshot cannot be tapped and
 * carries no attribution, so the lead never reaches the person who earned it.
 *
 * These tests hold the two things that make a link previewable: the page must
 * be rendered on the SERVER, and it must declare its own metadata.
 */

const FLYER_PAGE = 'app/f/[id]/page.tsx'
const FLYER_CLIENT = 'app/f/[id]/FlyerLanding.tsx'

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

/** Source with comments blanked — these files explain the rule in prose. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(l => (l.trim().startsWith('//') ? '' : l))
    .join('\n')
}

describe('a shared link previews as itself', () => {
  test('the flyer page is rendered on the server', () => {
    const page = code(read(FLYER_PAGE))

    assert.ok(!/^'use client'/m.test(page),
      'the flyer page is a client component again — a link crawler runs no ' +
      'JavaScript and would see an empty shell')
    assert.match(page, /export async function generateMetadata/,
      'the flyer page declares no metadata of its own')
  })

  test('the flyer itself is the preview image', () => {
    const page = code(read(FLYER_PAGE))

    // The image comes from the loaded flyer, never a fixed brand asset.
    assert.match(page, /flyer\.imageUrl/,
      'the preview image is not taken from the flyer')
    assert.match(page, /openGraph/, 'no Open Graph metadata')
    assert.match(page, /summary_large_image/,
      'the card is a thumbnail rather than a full-width image')

    // Dimensions: several platforms will not render a large card without them.
    assert.match(page, /width:\s*1200/, 'no card width declared')
    assert.match(page, /height:\s*630/, 'no card height declared')
  })

  test('the interactive half stays a client component', () => {
    // Splitting the page is what allows both: server metadata AND a form.
    assert.ok(existsSync(FLYER_CLIENT), 'the flyer form component is missing')
    assert.match(read(FLYER_CLIENT), /^'use client'/,
      'the flyer form is not a client component')
  })

  test('the flyer is read on the server, not fetched in the browser', () => {
    const page = code(read(FLYER_PAGE))
    assert.match(page, /loadPublicFlyer/,
      'the page does not load the flyer server-side')

    const client = code(read(FLYER_CLIENT))
    assert.ok(!/fetch\(`\/api\/flyers\/public\?id=\$\{id\}`\)\s*\.then/.test(client),
      'the client still fetches the flyer for rendering rather than receiving it')
  })

  test('every shareable public link carries its own card', () => {
    /*
     * The three links staff actually send to people. Each needs metadata of
     * its own; without it they inherit the root layout's generic crest.
     */
    const offenders: string[] = []

    for (const [label, file] of [
      ['the registration link', 'app/apply/[marketerId]/layout.tsx'],
      ['the referral link', 'app/refer/layout.tsx'],
    ] as const) {
      if (!existsSync(file)) { offenders.push(`${label}: ${file} is missing`); continue }
      const src = code(read(file))
      if (!/shareMetadata|openGraph/.test(src)) {
        offenders.push(`${label}: ${file} declares no share metadata`)
      }
      if (/^'use client'/m.test(src)) {
        offenders.push(`${label}: ${file} is a client component and cannot export metadata`)
      }
    }

    assert.deepEqual(offenders, [],
      'these links would preview as the generic Cambridge crest:\n  ' +
      offenders.join('\n  '))
  })

  test('a shared link is not offered to search engines', () => {
    /*
     * A personal campaign link is sent to a person. It should not compete with
     * the centre's own pages in a search result, and a marketer's flyers are
     * not site content.
     */
    assert.match(code(read(FLYER_PAGE)), /robots:\s*\{\s*index:\s*false/,
      'the flyer page is offered to search indexes')
  })

  test('attribution is resolved on the server, never sent by the client', () => {
    /*
     * The security property that makes the whole scheme safe: a prospect's
     * browser never says which marketer to credit. The server reads the
     * flyer's own marketer_id.
     */
    const submit = code(read('app/api/flyers/submit/route.ts'))

    assert.match(submit, /from\('flyers'\)[\s\S]{0,120}marketer_id/,
      'the submit route does not read the owner from the flyer')
    assert.match(submit, /preferredMarketerId:\s*flyer\.marketer_id/,
      'the lead is not attributed from the flyer record')
    assert.ok(!/body[\s\S]{0,200}\bmarketer_id\b\s*[,}]/.test(submit),
      'the submit route reads a marketer id out of the request body')
  })
})
