import { useCallback, useEffect, useRef, useState } from 'react'
import { STATIC } from '@/lib/api'
import { queryClient } from '@/lib/queries'

/** `static`: the static build, which has no API to check. */
export type Health = 'checking' | 'ok' | 'down' | 'static'

const POLL_OK_MS = 30_000
const POLL_DOWN_MS = 4_000

/**
 * Polls /api/health: every 30 s while the API is up, every 4 s while it's down.
 * When it comes back, every request that failed meanwhile is retried, so the page
 * recovers on its own without a reload.
 */
export function useApiHealth(): { health: Health; checkNow: () => void } {
  const [health, setHealth] = useState<Health>(STATIC ? 'static' : 'checking')
  const previous = useRef<Health>('checking')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (STATIC) return
    let cancelled = false
    let timer = 0
    const check = async () => {
      let next: Health
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        next = response.ok ? 'ok' : 'down'
      } catch {
        next = 'down'
      }
      if (cancelled) return
      if (next === 'ok' && previous.current === 'down') {
        void queryClient.refetchQueries({ predicate: (q) => q.state.status === 'error' })
      }
      previous.current = next
      setHealth(next)
      timer = window.setTimeout(check, next === 'ok' ? POLL_OK_MS : POLL_DOWN_MS)
    }
    void check()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [nonce])

  const checkNow = useCallback(() => setNonce((n) => n + 1), [])
  return { health, checkNow }
}
