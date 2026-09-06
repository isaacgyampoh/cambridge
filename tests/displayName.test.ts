import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { displayName, firstName } from '../lib/ui/name.ts'

/**
 * NAMES ARE DISPLAYED, NOT SHOUTED.
 *
 * Names reach this system from four places — a marketer typing into a form, a
 * Facebook lead-ad payload, a pasted CSV, a self-service application — and a
 * good proportion arrive in capitals. On the dashboard "PAUL ANGKYELLE" sat
 * above "Bright Ayiku" and read as emphasis the data never meant: the loudest
 * row looked like the most urgent one when it was only the one typed with
 * caps lock on.
 *
 * The stored value is never touched. An export, a letter and an admission
 * document must reproduce exactly what was entered.
 */

describe('a shouted name is calmed down', () => {
  test('all caps becomes a name', () => {
    assert.equal(displayName('PAUL ANGKYELLE'), 'Paul Angkyelle')
    assert.equal(displayName('AMA SERWAA BOATENG'), 'Ama Serwaa Boateng')
  })

  test('a name that was typed deliberately is left alone', () => {
    /*
     * Any lowercase letter means somebody chose the case. Re-casing those
     * would break the names most likely to be written carefully, and there is
     * no way to tell "de Souza" from a mistake.
     */
    for (const name of ['Bright Ayiku', 'Ama de Souza', 'Kofi van Dyk', 'Nana O. Mensah']) {
      assert.equal(displayName(name), name)
    }
  })

  test('a short initialism is not a shout', () => {
    // "AB" is somebody's initials, not somebody shouting.
    assert.equal(displayName('AB'), 'AB')
    assert.equal(displayName('KOA'), 'KOA')
  })

  test('particles stay lowercase inside a name, not at the front', () => {
    assert.equal(displayName('KOFI VAN DYK'), 'Kofi van Dyk')
    assert.equal(displayName('AMA DE SOUZA'), 'Ama de Souza')
    // Leading particle is still capitalised: it starts the name.
    assert.equal(displayName('DE SOUZA'), 'De Souza')
  })

  test('the awkward prefixes come out right', () => {
    assert.equal(displayName('SEAN MCDONALD'), 'Sean McDonald')
    assert.equal(displayName("PATRICK O'BRIEN"), "Patrick O'Brien")
  })

  test('hyphens and apostrophes start a new word', () => {
    assert.equal(displayName('AMA-SERWAA BOATENG'), 'Ama-Serwaa Boateng')
    assert.equal(displayName("N'DIAYE"), "N'Diaye")
  })

  test('whitespace is tidied and nothing is invented', () => {
    assert.equal(displayName('  PAUL   ANGKYELLE '), 'Paul Angkyelle')
    assert.equal(displayName(''), '')
    assert.equal(displayName(null), '')
    assert.equal(displayName(undefined), '')
  })

  test('a first name for a greeting', () => {
    assert.equal(firstName('PAUL ANGKYELLE'), 'Paul')
    assert.equal(firstName('Bright Ayiku'), 'Bright')
    assert.equal(firstName(''), '')
  })
})
