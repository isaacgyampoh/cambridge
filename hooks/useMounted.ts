'use client'

import { useSyncExternalStore } from 'react'

/**
 * True once the component is running in the browser, false while rendering
 * on the server.
 *
 * ── WHY NOT useState + useEffect ───────────────────────────────────────────
 *
 * The usual spelling is
 *
 *     const [mounted, setMounted] = useState(false)
 *     useEffect(() => { setMounted(true) }, [])
 *
 * which works, but it sets state from inside an effect: React commits the
 * first render with `false`, then immediately renders again with `true`. On a
 * dialog or a command palette — the two places this is used — that is a
 * guaranteed double render every time the component appears, and React 19
 * reports it as a cascading render.
 *
 * useSyncExternalStore was built for exactly this question: read a value that
 * differs between server and client. The server snapshot is `false`, the
 * client snapshot is `true`, and React reconciles it as part of hydration
 * rather than as a state update afterwards.
 *
 * Nothing ever changes after mount, so the subscribe function has nothing to
 * subscribe to and returns an unsubscribe that does nothing. Both are declared
 * once at module scope: passing new function identities on every render would
 * make useSyncExternalStore re-read on every render.
 */
const subscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
