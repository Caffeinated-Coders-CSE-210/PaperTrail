import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PaperId } from '../../shared/paper'
import { constellationLikeCounter } from './constellation'
import type { LikeCounter, LikeStore } from './service'

type Count = number | 'error'
type Liked = boolean | 'error'

/** One account's likes. Switching accounts discards them, so late results from another account are ignored. */
interface AccountLikes {
  store: LikeStore | null
  /** Whether each paper was liked when it was loaded. The public count is assumed to include these likes. */
  initial: Partial<Record<PaperId, boolean>>
  liked: Partial<Record<PaperId, Liked>>
  pending: ReadonlySet<PaperId>
}

interface LikesValue {
  store: LikeStore | null
  authPending: boolean
  counts: Partial<Record<PaperId, Count>>
  account: AccountLikes
  load(id: PaperId): void
  retry(id: PaperId): void
  /**
   * Rejects if the like could not be saved or removed, after restoring the previous state.
   * Resolves without changes if the account switched before the write finished.
   */
  toggle(id: PaperId): Promise<void>
}

const LikesContext = createContext<LikesValue | null>(null)

function emptyAccount(store: LikeStore | null): AccountLikes {
  return { store, initial: {}, liked: {}, pending: new Set() }
}

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
  const [savedAccount, setAccount] = useState(() => emptyAccount(store))
  const requestedCounts = useRef(new Set<PaperId>())
  const requestedLikes = useRef(new WeakMap<LikeStore, Set<PaperId>>())
  const pendingWrites = useRef(new WeakMap<LikeStore, Set<PaperId>>())
  const activeStore = useRef(store)
  useEffect(() => { activeStore.current = store }, [store])

  const account = savedAccount.store === store ? savedAccount : emptyAccount(store)

  const update = useCallback((owner: LikeStore, change: (account: AccountLikes) => AccountLikes) => {
    if (activeStore.current !== owner) return
    setAccount((prev) => change(prev.store === owner ? prev : emptyAccount(owner)))
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
      (value) => update(store, (prev) => ({
        ...prev,
        initial: { ...prev.initial, [id]: value },
        liked: { ...prev.liked, [id]: value },
      })),
      () => {
        requested.delete(id)
        update(store, (prev) => ({ ...prev, liked: { ...prev.liked, [id]: 'error' } }))
      },
    )
  }, [counter, store, update])

  const retry = useCallback((id: PaperId) => {
    if (!store) return
    update(store, (prev) => {
      const { [id]: _failed, ...liked } = prev.liked
      return { ...prev, liked }
    })
    load(id)
  }, [store, update, load])

  const toggle = useCallback(async (id: PaperId) => {
    const current = account.liked[id]
    if (!store || typeof current !== 'boolean') return
    let writes = pendingWrites.current.get(store)
    if (!writes) pendingWrites.current.set(store, writes = new Set())
    if (writes.has(id)) return

    function setState(liked: boolean, pending: boolean) {
      update(store!, (prev) => {
        const ids = new Set(prev.pending)
        if (pending) ids.add(id)
        else ids.delete(id)
        return { ...prev, liked: { ...prev.liked, [id]: liked }, pending: ids }
      })
    }

    writes.add(id)
    setState(!current, true)
    try {
      await (current ? store.unlike(id) : store.like(id))
      setState(!current, false)
    } catch (error) {
      setState(current, false)
      if (activeStore.current === store) throw error
    } finally {
      writes.delete(id)
    }
  }, [account, store, update])

  const value = useMemo(
    () => ({ store, authPending, counts, account, load, retry, toggle }),
    [store, authPending, counts, account, load, retry, toggle],
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

  const { account } = likes
  let liked: LikedState
  if (likes.store) liked = account.liked[id] ?? 'loading'
  else liked = likes.authPending ? 'restoring' : 'signed-out'

  let count: LikeCountState = likes.counts[id] ?? 'loading'
  const initial = account.initial[id]
  if (typeof count === 'number' && typeof liked === 'boolean' && initial !== undefined) {
    // The public count comes from an index. Apply this session's change on top of it,
    // and count the account's own like even if the index has not caught up.
    count = Math.max(count - Number(initial) + Number(liked), Number(liked))
  }

  return {
    /** Identifies the active account, so per-account UI state can reset when it changes. */
    account: likes.store,
    count,
    liked,
    pending: account.pending.has(id),
    toggle: () => likes.toggle(id),
    retry: () => likes.retry(id),
  }
}

export function formatLikes(count: number) {
  return count === 1 ? '1 like' : `${count} likes`
}
