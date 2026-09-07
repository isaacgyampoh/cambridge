import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * THE STUDENT PORTAL AND THE DEMO OF IT.
 *
 * Both bugs here were found by opening the pages in a browser and pressing
 * the buttons, which is the only way either of them was ever going to be
 * found: the build was clean, the types were right, and every test passed.
 */

const view = readFileSync('app/portal/PortalView.tsx', 'utf8')
const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the public demo shows the state you picked', () => {
  /*
   * ── WHAT WENT WRONG ────────────────────────────────────────────────────
   *
   *     const [d, setD] = useState(demo ? demoData ?? null : null)
   *
   * useState keeps only its FIRST argument. The initialiser runs once, and
   * every later value of `demoData` is ignored — so /portal/demo highlighted
   * the button you pressed and went on showing the first state for ever.
   * "Paid up — can join" left "Payment required to join" on screen; "Cohort
   * finished" never appeared at all.
   *
   * That is the page the portal gets demonstrated with.
   */
  test('demo data is derived from the prop, never copied into state', () => {
    assert.ok(!/useState[^(]*\(\s*demo\s*\?/.test(code),
      'demoData is being latched by useState again — the demo will show the ' +
      'first state whatever the visitor presses')
    assert.match(code, /const d = demo \? demoData \?\? null : fetched/,
      'the rendered data is no longer derived from the prop')
  })

  test('only the fetch writes the stored value', () => {
    // If anything else set it, the derived/stored split would be a lie.
    const setters = [...code.matchAll(/setFetched\(/g)].length
    assert.equal(setters, 2, `setFetched is called ${setters} times; the load ` +
      'callback and the initial effect are the only two that should')
  })

  test('the three demo states are genuinely different', () => {
    const demo = readFileSync('app/portal/demo/page.tsx', 'utf8')
    const canJoin = [...demo.matchAll(/canJoin:\s*(true|false)/g)].map(m => m[1])
    const ended = [...demo.matchAll(/cohortEnded:\s*(true|false)/g)].map(m => m[1])

    assert.deepEqual(canJoin, ['false', 'true', 'false'],
      'the demo states no longer differ in whether the student can join')
    assert.deepEqual(ended, ['false', 'false', 'true'],
      'no demo state shows a finished cohort')
  })
})

describe('one payment ask at a time', () => {
  /*
   * The amber "Payment required to join" block and the Fees card's "Make a
   * payment" both called setTab('payments') — the same action, under two
   * near-identical labels, one scroll apart.
   *
   * Two primary buttons for one thing is not twice the prompt. It makes the
   * specific ask ("pay GHS 300 to unlock session 2") look like the general
   * one, and a student skims past both.
   */
  test('the general fees button stands down while the class is asking', () => {
    assert.match(code, /const classIsAskingForPayment = Boolean\(/,
      'nothing tracks whether the class card is already asking for money')
    assert.match(code, /f\.balance > 0 && !classIsAskingForPayment/,
      'the Fees card shows a second payment button beside the urgent one')
  })

  test('the condition matches the branch that renders the amber block', () => {
    // classStatus() falls through to "Payment required to join" exactly when
    // there is a batch and a session, the cohort has not ended, and the
    // student cannot join. The flag must say the same thing.
    assert.match(code, /d\?\.batch && s && !s\.cohortEnded && !s\.canJoin/,
      'the flag and the render branch can disagree, so the Fees button would ' +
      'be hidden when nothing else is asking, or shown beside the amber block')
  })

  test('a student who owes nothing is not asked to pay', () => {
    assert.match(code, /f && f\.balance > 0/,
      'the Fees card offers a payment button with nothing outstanding')
  })
})
