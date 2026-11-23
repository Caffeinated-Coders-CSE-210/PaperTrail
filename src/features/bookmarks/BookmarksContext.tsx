import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Paper, PaperId } from '../../shared/paper'
import { createLocalBookmarkStorage } from './localBookmarks'
import type { BookmarkStorage } from './storage'

/** How bookmarks are stored for an account. `isLocal` storage must be disclosed in the UI. */
export interface BookmarkBackend {
  isLocal: boolean
  create(did: string): BookmarkStorage
}

export const localBookmarkBackend: BookmarkBackend = {
  isLocal: true,
  create: (did) => createLocalBookmarkStorage(did),
}

export type BookmarksStatus = 'signed-out' | 'loading' | 'ready' | 'error'

interface BookmarksValue {
  status: BookmarksStatus
  /** Saved papers, newest first. Empty unless `status` is `ready`. */
  papers: Paper[]
  isLocal: boolean
  isSaved(id: PaperId): boolean
  isPending(id: PaperId): boolean
  /** Rejects if the paper could not be saved. */
  savePaper(paper: Paper): Promise<void>
  /** Rejects if the bookmark could not be removed. */
  removePaper(id: PaperId): Promise<void>
  reload(): void
}

const signedOut = async () => { throw new Error('Sign in to manage bookmarks') }

/** Without a provider, the bookmark UI renders as signed out. */
const BookmarksContext = createContext<BookmarksValue>({
  status: 'signed-out',
  papers: [],
  isLocal: true,
  isSaved: () => false,
  isPending: () => false,
  savePaper: signedOut,
  removePaper: signedOut,
  reload: () => {},
})

/**
 * Shares the active account's library between the bookmark button and the saved page.
 * Mount at the root with the signed-in DID, or `null` when signed out.
 */
export function BookmarksProvider({
  accountDid,
  authPending = false,
  backend = localBookmarkBackend,
  children,
}: {
  accountDid: string | null
  /** While the session is being restored, show loading instead of signed out. */
  authPending?: boolean
  backend?: BookmarkBackend
  children: ReactNode
}) {
  const { storage, storageError } = useMemo(() => {
    if (!accountDid) return { storage: null, storageError: false }
    try {
      return { storage: backend.create(accountDid), storageError: false }
    } catch {
      return { storage: null, storageError: true }
    }
  }, [accountDid, backend])
  const [papers, setPapers] = useState<Paper[]>([])
  const [status, setStatus] = useState<BookmarksStatus>(
    storageError ? 'error' : storage || authPending ? 'loading' : 'signed-out',
  )
  const [pending, setPending] = useState<ReadonlySet<PaperId>>(new Set())
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setPapers([])
    setPending(new Set())
    if (storageError) {
      setStatus('error')
      return
    }
    if (!storage) {
      setStatus(authPending ? 'loading' : 'signed-out')
      return
    }
    let active = true
    setStatus('loading')
    storage.listSavedPapers().then(
      (saved) => {
        if (!active) return
        setPapers(saved)
        setStatus('ready')
      },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [storage, storageError, authPending, reloadKey])

  const track = useCallback(async (id: PaperId, operation: () => Promise<void>) => {
    setPending((ids) => new Set(ids).add(id))
    try {
      await operation()
    } finally {
      setPending((ids) => {
        const next = new Set(ids)
        next.delete(id)
        return next
      })
    }
  }, [])

  const value = useMemo<BookmarksValue>(() => {
    const savedIds = new Set(papers.map((paper) => paper.id))
    return {
      status,
      papers,
      isLocal: backend.isLocal,
      isSaved: (id) => savedIds.has(id),
      isPending: (id) => pending.has(id),
      async savePaper(paper) {
        if (!storage || status !== 'ready') return signedOut()
        await track(paper.id, () => storage.savePaper(paper))
        setPapers((current) => (current.some((saved) => saved.id === paper.id)
          ? current.map((saved) => (saved.id === paper.id ? paper : saved))
          : [paper, ...current]))
      },
      async removePaper(id) {
        if (!storage || status !== 'ready') return signedOut()
        await track(id, () => storage.removeSavedPaper(id))
        setPapers((current) => current.filter((saved) => saved.id !== id))
      },
      reload: () => setReloadKey((key) => key + 1),
    }
  }, [status, papers, pending, storage, backend.isLocal, track])

  return <BookmarksContext value={value}>{children}</BookmarksContext>
}

export function useBookmarks() {
  return useContext(BookmarksContext)
}
