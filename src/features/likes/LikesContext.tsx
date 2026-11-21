import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PaperId } from '../../shared/paper'
import { constellationLikeCounter } from './constellation'
import { LikePermissionError, type LikeCounter, type LikeStore } from './service'

type Count = number | 'error'
type Liked = boolean | 'error'
export type WriteFailure = 'like' | 'unlike' | 'permission'

/**
 * One sign-in of an account, created whenever the store changes. Results from an earlier session are
 * ignored, even if the same store comes back. A write still running from an earlier session is not
 * tracked by the new one.
 */
interface Session {
  store: LikeStore | null
  /** Papers whose like state has been requested. */
  requested: Set<PaperId>
  /** Papers with a write in progress. Blocks repeated clicks before the pending state renders. */
  writes: Set<PaperId>
}

/** The active session's likes. */
interface AccountLikes {
  session: Session
  /** Whether each paper was liked when it was loaded. The public count is assumed to include these likes. */
  initial: Partial<Record<PaperId, boolean>>
  liked: Partial<Record<PaperId, Liked>>
  pending: ReadonlySet<PaperId>
  /** The last write that failed for each paper, cleared by the next attempt. */
  failed: Partial<Record<PaperId, WriteFailure>>
}

interface LikesValue {
  authPending: boolean
  counts: Partial<Record<PaperId, Count>>
  account: AccountLikes
  load(id: PaperId): void
  retry(id: PaperId): void
  /** Restores the previous state and records the failure if the write fails. */
  toggle(id: PaperId): Promise<void>
}

const LikesContext = createContext<LikesValue | null>(null)

function newSession(store: LikeStore | null): Session {
  return { store, requested: new Set(), writes: new Set() }
}

function emptyAccount(session: Session): AccountLikes {
  return { session, initial: {}, liked: {}, pending: new Set(), failed: {} }
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
  const [session, setSession] = useState(() => newSession(store))
  if (session.store !== store) setSession(newSession(store))
  const [counts, setCounts] = useState<Partial<Record<PaperId, Count>>>({})
  const [savedAccount, setAccount] = useState(() => emptyAccount(session))
  const requestedCounts = useRef(new Set<PaperId>())
  const activeSession = useRef(session)
  useEffect(() => { activeSession.current = session }, [session])

  const account = savedAccount.session === session ? savedAccount : emptyAccount(session)

  const update = useCallback((owner: Session, change: (account: AccountLikes) => AccountLikes) => {
    if (activeSession.current !== owner) return
    setAccount((prev) => change(prev.session === owner ? prev : emptyAccount(owner)))
  }, [])

  const load = useCallback((id: PaperId) => {
    if (!requestedCounts.current.has(id)) {
      requestedCounts.current.add(id)
      counter.countLikes(id).then(
        (count) => setCounts((prev) => ({ ...prev, [id]: count })),
        () => setCounts((prev) => ({ ...prev, [id]: 'error' })),
      )
    }
    const { store, requested } = session
    if (!store || requested.has(id)) return
    requested.add(id)
    store.hasLiked(id).then(
      (value) => update(session, (prev) => ({
        ...prev,
        initial: { ...prev.initial, [id]: value },
        liked: { ...prev.liked, [id]: value },
      })),
      () => {
        requested.delete(id)
        update(session, (prev) => ({ ...prev, liked: { ...prev.liked, [id]: 'error' } }))
      },
    )
  }, [counter, session, update])

  const retry = useCallback((id: PaperId) => {
    update(session, (prev) => {
      const { [id]: _failed, ...liked } = prev.liked
      return { ...prev, liked }
    })
    load(id)
  }, [session, update, load])

  const toggle = useCallback(async (id: PaperId) => {
    const { store, writes } = session
    const current = account.liked[id]
    if (!store || typeof current !== 'boolean' || writes.has(id)) return

    function settle(liked: boolean, pending: boolean, failure?: WriteFailure) {
      update(session, (prev) => {
        const ids = new Set(prev.pending)
        if (pending) ids.add(id)
        else ids.delete(id)
        return {
          ...prev,
          liked: { ...prev.liked, [id]: liked },
          pending: ids,
          failed: { ...prev.failed, [id]: failure },
        }
      })
    }

    writes.add(id)
    settle(!current, true)
    try {
      await (current ? store.unlike(id) : store.like(id))
      settle(!current, false)
    } catch (error) {
      settle(current, false, error instanceof LikePermissionError ? 'permission' : current ? 'unlike' : 'like')
    } finally {
      writes.delete(id)
    }
  }, [account, session, update])

  const value = useMemo(
    () => ({ authPending, counts, account, load, retry, toggle }),
    [authPending, counts, account, load, retry, toggle],
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
  if (account.session.store) liked = account.liked[id] ?? 'loading'
  else liked = likes.authPending ? 'restoring' : 'signed-out'

  let count: LikeCountState = likes.counts[id] ?? 'loading'
  if (typeof count === 'number' && typeof liked === 'boolean') {
    // The public count comes from an index. Apply this session's change on top of it,
    // and count the account's own like even if the index has not caught up.
    count = Math.max(count - Number(account.initial[id]) + Number(liked), Number(liked))
  }

  return {
    count,
    liked,
    pending: account.pending.has(id),
    failure: account.failed[id],
    toggle: () => { void likes.toggle(id) },
    retry: () => likes.retry(id),
  }
}

export function formatLikes(count: number) {
  return count === 1 ? '1 like' : `${count} likes`
}
