import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PaperId } from '../../shared/paper'
import { constellationLikeCounter } from './constellation'
import type { LikeCounter, LikeStore } from './service'

type Count = number | 'error'
type Liked = boolean | 'error'

/** Results that belong to one account. Switching accounts discards them. */
interface AccountLikes {
  store: LikeStore | null
  liked: Partial<Record<PaperId, Liked>>
}

interface LikesValue {
  store: LikeStore | null
  authPending: boolean
  counts: Partial<Record<PaperId, Count>>
  liked: Partial<Record<PaperId, Liked>>
  pending: ReadonlySet<PaperId>
  load(id: PaperId): void
  /** Rejects if the like could not be saved or removed. The previous state is restored. */
  toggle(id: PaperId): Promise<void>
}

const LikesContext = createContext<LikesValue | null>(null)

/**
 * Shares like counts and the signed-in account's likes across buttons and cards.
 * Mount once at the root with the account's store, or `null` when signed out.
 * The counter is expected to stay the same for the provider's lifetime.
 */
export function LikesProvider({
  store,
  authPending = false,
  counter = constellationLikeCounter,
  children,
}: {
  store: LikeStore | null
  /** While the session is being restored, disable the button instead of showing sign-in. */
  authPending?: boolean
  counter?: LikeCounter
  children: ReactNode
}) {
  const [counts, setCounts] = useState<Partial<Record<PaperId, Count>>>({})
  const [account, setAccount] = useState<AccountLikes>({ store, liked: {} })
  const [pending, setPending] = useState<ReadonlySet<PaperId>>(new Set())
  const requestedCounts = useRef(new Set<PaperId>())
  const requestedLikes = useRef(new WeakMap<LikeStore, Set<PaperId>>())
  const pendingIds = useRef(new Set<PaperId>())
  const activeStore = useRef(store)
  useEffect(() => { activeStore.current = store }, [store])

  const liked = account.store === store ? account.liked : {}

  const setLiked = useCallback((owner: LikeStore, id: PaperId, value: Liked) => {
    if (activeStore.current !== owner) return
    setAccount((prev) => ({
      store: owner,
      liked: { ...(prev.store === owner ? prev.liked : {}), [id]: value },
    }))
  }, [])

  const load = useCallback((id: PaperId) => {
    if (!requestedCounts.current.has(id)) {
      requestedCounts.current.add(id)
      counter.countLikes(id).then(
        (count) => setCounts((prev) => ({ ...prev, [id]: count })),
        () => setCounts((prev) => ({ ...prev, [id]: 'error' })),
      )
    }
    if (!store) return
    let requested = requestedLikes.current.get(store)
    if (!requested) requestedLikes.current.set(store, requested = new Set())
    if (requested.has(id)) return
    requested.add(id)
    store.hasLiked(id).then(
      (value) => setLiked(store, id, value),
      () => setLiked(store, id, 'error'),
    )
  }, [counter, store, setLiked])

  const toggle = useCallback(async (id: PaperId) => {
    const current = liked[id]
    if (!store || typeof current !== 'boolean' || pendingIds.current.has(id)) return

    function apply(value: boolean) {
      setLiked(store!, id, value)
      setCounts((prev) => {
        const count = prev[id]
        return typeof count === 'number' ? { ...prev, [id]: count + (value ? 1 : -1) } : prev
      })
    }

    pendingIds.current.add(id)
    setPending(new Set(pendingIds.current))
    apply(!current)
    try {
      await (current ? store.unlike(id) : store.like(id))
    } catch (error) {
      if (activeStore.current === store) apply(current)
      throw error
    } finally {
      pendingIds.current.delete(id)
      setPending(new Set(pendingIds.current))
    }
  }, [liked, store, setLiked])

  const value = useMemo(
    () => ({ store, authPending, counts, liked, pending, load, toggle }),
    [store, authPending, counts, liked, pending, load, toggle],
  )
  return <LikesContext.Provider value={value}>{children}</LikesContext.Provider>
}

export type LikeCountState = number | 'loading' | 'error'
export type LikedState = boolean | 'loading' | 'error' | 'signed-out' | 'restoring'

/** Like state for one paper, or `null` outside a `LikesProvider`. */
export function usePaperLikes(id: PaperId) {
  const likes = useContext(LikesContext)
  const load = likes?.load
  useEffect(() => { load?.(id) }, [load, id])
  if (!likes) return null

  let liked: LikedState
  if (likes.store) liked = likes.liked[id] ?? 'loading'
  else liked = likes.authPending ? 'restoring' : 'signed-out'

  let count: LikeCountState = likes.counts[id] ?? 'loading'
  // The public index can lag behind the account's own like.
  if (typeof count === 'number') count = Math.max(count, liked === true ? 1 : 0)

  return {
    count,
    liked,
    pending: likes.pending.has(id),
    toggle: () => likes.toggle(id),
  }
}

export function formatLikes(count: number) {
  return count === 1 ? '1 like' : `${count} likes`
}
