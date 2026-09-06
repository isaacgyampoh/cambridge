'use client'

import { useSyncExternalStore, useCallback } from 'react'

/**
 * Whether the desktop sidebar is narrowed to an icon rail.
 *
 * A preference that lives in the browser, so it survives a reload — someone
 * who wants the widest possible workspace should not have to re-narrow the
 * sidebar on every page load.
 *
 * useSyncExternalStore rather than useState-plus-useEffect: reading
 * localStorage in an effect and calling setState with the result renders the
 * shell twice on every mount, once at the default and once at the truth, which
 * is a visible flicker of the whole sidebar. This subscribes to the value
 * instead, and returns `false` for the server snapshot so hydration matches.
 */

const KEY = 'cce.nav.railed'
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab changing the preference should move this one too.
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) listener() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Private browsing, or site data blocked. The default is fine.
    return false
  }
}

/** The server has no preference to read; false keeps hydration consistent. */
function getServerSnapshot(): boolean {
  return false
}

export function useRailPreference(): [boolean, () => void] {
  const railed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = useCallback(() => {
    try {
      localStorage.setItem(KEY, getSnapshot() ? '0' : '1')
    } catch { /* the toggle simply does not persist */ }
    for (const listener of listeners) listener()
  }, [])

  return [railed, toggle]
}
