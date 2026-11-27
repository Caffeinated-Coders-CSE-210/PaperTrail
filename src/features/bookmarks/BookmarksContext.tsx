import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Paper, PaperId } from '../../shared/paper'
import { createLocalBookmarkStorage, type BookmarkImportSource } from './localBookmarks'
import type { BookmarkStorage } from './storage'

/** How bookmarks are stored for an account. `isLocal` storage must be disclosed in the UI. */
export interface BookmarkBackend {
  isLocal: boolean
  create(did: string): BookmarkStorage
  /** Browser bookmarks the user may upload. Only account-backed storage offers this. */
  importSource?(did: string): BookmarkImportSource
}

export const localBookmarkBackend: BookmarkBackend = {
  isLocal: true,
  create: (did) => createLocalBookmarkStorage(did),
}

export type BookmarksStatus = 'signed-out' | 'loading' | 'ready' | 'error'

interface BookmarksValue {
  status: BookmarksStatus
  /** Why loading failed, for `bookmarkErrorMessage`. `null` unless `status` is `error`. */
  loadError: unknown
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
  /** Browser-only bookmarks the user hasn't uploaded or kept private yet. */
  importable: Paper[]
  importing: boolean
  /** Uploads `importable` to the account. Rejects on the first failure; uploaded papers stay uploaded. */
  importLocalBookmarks(): Promise<void>
  /** Leaves `importable` in this browser and stops offering the upload. */
  keepLocalBookmarks(): Promise<void>
}

const signedOut = async () => { throw new Error('Sign in to manage bookmarks') }

/** Without a provider, the bookmark UI renders as signed out. */
const BookmarksContext = createContext<BookmarksValue>({
  status: 'signed-out',
  loadError: null,
  papers: [],
  isLocal: true,
  isSaved: () => false,
  isPending: () => false,
  savePaper: signedOut,
  removePaper: signedOut,
  reload: () => {},
  importable: [],
  importing: false,
  importLocalBookmarks: signedOut,
  keepLocalBookmarks: signedOut,
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
  const [creationRetryKey, setCreationRetryKey] = useState(0)
  const { storage, importSource, storageError } = useMemo(() => {
    if (!accountDid) return { storage: null, importSource: null, storageError: null }
    try {
      return {
        storage: backend.create(accountDid),
        importSource: backend.importSource?.(accountDid) ?? null,
        storageError: null,
      }
    } catch (error) {
      return { storage: null, importSource: null, storageError: error ?? new Error('Bookmarks unavailable') }
    }
  }, [accountDid, backend, creationRetryKey])
  const [papers, setPapers] = useState<Paper[]>([])
  const [status, setStatus] = useState<BookmarksStatus>(
    storageError ? 'error' : storage || authPending ? 'loading' : 'signed-out',
  )
  const [loadError, setLoadError] = useState<unknown>(storageError)
  const [pending, setPending] = useState<ReadonlySet<PaperId>>(new Set())
  const [importable, setImportable] = useState<Paper[]>([])
  const [importing, setImporting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  /** The active account's storage. Async work from an earlier account checks this before touching shared state. */
  const currentStorage = useRef(storage)

  useEffect(() => {
    currentStorage.current = storage
    setPapers([])
    setPending(new Set())
    setImportable([])
    setImporting(false)
    setLoadError(storageError)
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
      (error: unknown) => {
        if (!active) return
        setLoadError(error)
        setStatus('error')
      },
    )
    // A broken browser store shouldn't block the account library, so a failure just skips the offer.
    importSource?.listPending().then(
      (local) => { if (active) setImportable(local) },
      () => {},
    )
    return () => { active = false }
  }, [storage, importSource, storageError, authPending, reloadKey])

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
    const ready = storage && status === 'ready' ? storage : null
    const isCurrent = () => ready !== null && currentStorage.current === ready

    function addPaper(paper: Paper) {
      setPapers((current) => (current.some((saved) => saved.id === paper.id)
        ? current.map((saved) => (saved.id === paper.id ? paper : saved))
        : [paper, ...current]))
    }

    return {
      status,
      loadError,
      papers,
      isLocal: backend.isLocal,
      isSaved: (id) => savedIds.has(id),
      isPending: (id) => pending.has(id),
      async savePaper(paper) {
        if (!ready) return signedOut()
        await track(paper.id, () => ready.savePaper(paper))
        if (isCurrent()) addPaper(paper)
      },
      async removePaper(id) {
        if (!ready) return signedOut()
        await track(id, () => ready.removeSavedPaper(id))
        if (isCurrent()) setPapers((current) => current.filter((saved) => saved.id !== id))
      },
      reload: () => {
        if (storageError) setCreationRetryKey((key) => key + 1)
        else setReloadKey((key) => key + 1)
      },
      importable,
      importing,
      async importLocalBookmarks() {
        if (!ready || !importSource || importing) return signedOut()
        setImporting(true)
        try {
          // Oldest first, so the newest local bookmark gets the newest timestamp.
          for (const paper of [...importable].reverse()) {
            // Stop if the account changed; this loop's storage and source belong to the earlier account.
            if (!isCurrent()) return
            await ready.savePaper(paper)
            // The upload finished, so clear it from that account's browser list even if the account changed.
            await importSource.markUploaded(paper.id)
            if (!isCurrent()) return
            addPaper(paper)
            setImportable((current) => current.filter((local) => local.id !== paper.id))
          }
        } finally {
          if (isCurrent()) setImporting(false)
        }
      },
      async keepLocalBookmarks() {
        if (!importSource) return signedOut()
        await importSource.keepLocal()
        setImportable([])
      },
    }
  }, [status, loadError, papers, pending, storage, importSource, storageError, backend.isLocal, track, importable, importing])

  return <BookmarksContext value={value}>{children}</BookmarksContext>
}

export function useBookmarks() {
  return useContext(BookmarksContext)
}
