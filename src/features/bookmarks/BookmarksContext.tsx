import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Paper, PaperId } from '../../shared/paper'
import { createLocalBookmarkStorage, type BrowserBookmarkSource } from './localBookmarks'
import type { BookmarkStorage } from './storage'

/** How bookmarks are stored for an account. `isLocal` storage must be disclosed in the UI. */
export interface BookmarkBackend {
  isLocal: boolean
  create(did: string): BookmarkStorage
  /** Private bookmarks kept in this browser alongside account storage. */
  browserBookmarks?(did: string): BrowserBookmarkSource
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
  /** Bookmarks in the account's storage, newest first. Empty unless `status` is `ready`. */
  papers: Paper[]
  isLocal: boolean
  /** Saved in the account or in this browser. */
  isSaved(id: PaperId): boolean
  isPending(id: PaperId): boolean
  /** Saves to the account and drops any browser copy. Rejects if the paper could not be saved. */
  savePaper(paper: Paper): Promise<void>
  /** Removes the bookmark wherever it is saved. Rejects if it could not be removed. */
  removePaper(id: PaperId): Promise<void>
  reload(): void
  /** Bookmarks saved only in this browser, newest first. */
  browserPapers: Paper[]
  /** The user chose to keep `browserPapers` private, so the upload prompt is hidden. */
  keptLocal: boolean
  uploading: boolean
  /** Uploads `browserPapers` to the account. Rejects on the first failure; uploaded papers stay uploaded. */
  uploadBrowserBookmarks(): Promise<void>
  keepBrowserBookmarks(): Promise<void>
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
  browserPapers: [],
  keptLocal: false,
  uploading: false,
  uploadBrowserBookmarks: signedOut,
  keepBrowserBookmarks: signedOut,
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
  const { storage, browser, storageError } = useMemo(() => {
    if (!accountDid) return { storage: null, browser: null, storageError: null }
    try {
      return {
        storage: backend.create(accountDid),
        browser: backend.browserBookmarks?.(accountDid) ?? null,
        storageError: null,
      }
    } catch (error) {
      return { storage: null, browser: null, storageError: error ?? new Error('Bookmarks unavailable') }
    }
  }, [accountDid, backend, creationRetryKey])
  const [papers, setPapers] = useState<Paper[]>([])
  const [status, setStatus] = useState<BookmarksStatus>(
    storageError ? 'error' : storage || authPending ? 'loading' : 'signed-out',
  )
  const [loadError, setLoadError] = useState<unknown>(storageError)
  const [pending, setPending] = useState<ReadonlySet<PaperId>>(new Set())
  const [browserPapers, setBrowserPapers] = useState<Paper[]>([])
  const [keptLocal, setKeptLocal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  /** The active account's storage. Async work from an earlier account checks this before touching shared state. */
  const currentStorage = useRef(storage)
  // Update at commit time. A passive effect runs later, leaving a gap where old async work still looks current.
  useLayoutEffect(() => {
    currentStorage.current = storage
  }, [storage])

  useEffect(() => {
    setPapers([])
    setPending(new Set())
    setBrowserPapers([])
    setKeptLocal(false)
    setUploading(false)
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
    // A broken browser store shouldn't block the account library, so a failure just shows no browser bookmarks.
    if (browser) {
      Promise.all([browser.list(), browser.isKeptLocal()]).then(
        ([local, kept]) => {
          if (!active) return
          setBrowserPapers(local)
          setKeptLocal(kept)
        },
        () => {},
      )
    }
    return () => { active = false }
  }, [storage, browser, storageError, authPending, reloadKey])

  /** Marks `id` pending during `operation`. Only clears it while the starting account is still active. */
  const track = useCallback(async (id: PaperId, operation: () => Promise<void>, isCurrent: () => boolean) => {
    setPending((ids) => new Set(ids).add(id))
    try {
      await operation()
    } finally {
      if (isCurrent()) setPending((ids) => {
        const next = new Set(ids)
        next.delete(id)
        return next
      })
    }
  }, [])

  const value = useMemo<BookmarksValue>(() => {
    const accountIds = new Set(papers.map((paper) => paper.id))
    // A paper saved in both places (e.g. from another device) is shown once, as an account bookmark.
    const browserOnly = browserPapers.filter((paper) => !accountIds.has(paper.id))
    const browserIds = new Set(browserOnly.map((paper) => paper.id))
    const ready = storage && status === 'ready' ? storage : null
    const isCurrent = () => ready !== null && currentStorage.current === ready

    function addPaper(paper: Paper) {
      setPapers((current) => (current.some((saved) => saved.id === paper.id)
        ? current.map((saved) => (saved.id === paper.id ? paper : saved))
        : [paper, ...current]))
    }

    function dropBrowserPaper(id: PaperId) {
      setBrowserPapers((current) => current.filter((paper) => paper.id !== id))
    }

    return {
      status,
      loadError,
      papers,
      isLocal: backend.isLocal,
      isSaved: (id) => accountIds.has(id) || browserIds.has(id),
      isPending: (id) => pending.has(id),
      async savePaper(paper) {
        if (!ready) return signedOut()
        await track(paper.id, async () => {
          await ready.savePaper(paper)
          // The account copy now exists, so a leftover browser copy is redundant. Keep it if cleanup fails.
          if (browser && browserPapers.some((local) => local.id === paper.id)) {
            await browser.remove(paper.id).then(() => { if (isCurrent()) dropBrowserPaper(paper.id) }, () => {})
          }
        }, isCurrent)
        if (isCurrent()) addPaper(paper)
      },
      async removePaper(id) {
        if (!ready) return signedOut()
        const inAccount = accountIds.has(id)
        const inBrowser = browser !== null && browserPapers.some((local) => local.id === id)
        await track(id, async () => {
          if (inAccount) await ready.removeSavedPaper(id)
          if (inBrowser) await browser.remove(id)
        }, isCurrent)
        if (!isCurrent()) return
        if (inAccount) setPapers((current) => current.filter((saved) => saved.id !== id))
        if (inBrowser) dropBrowserPaper(id)
      },
      reload: () => {
        if (storageError) setCreationRetryKey((key) => key + 1)
        else setReloadKey((key) => key + 1)
      },
      browserPapers: browserOnly,
      keptLocal,
      uploading,
      async uploadBrowserBookmarks() {
        if (!ready || !browser || uploading) return signedOut()
        setUploading(true)
        try {
          // Oldest first, so the newest browser bookmark gets the newest timestamp.
          for (const paper of [...browserOnly].reverse()) {
            // Stop if the account changed; this loop's storage and source belong to the earlier account.
            if (!isCurrent()) return
            await ready.savePaper(paper)
            // The upload finished, so clear it from that account's browser list even if the account changed.
            await browser.remove(paper.id)
            if (!isCurrent()) return
            addPaper(paper)
            dropBrowserPaper(paper.id)
          }
        } finally {
          if (isCurrent()) setUploading(false)
        }
      },
      async keepBrowserBookmarks() {
        if (!browser) return signedOut()
        await browser.keepLocal()
        if (isCurrent()) setKeptLocal(true)
      },
    }
  }, [status, loadError, papers, pending, storage, browser, storageError, backend.isLocal, track, browserPapers, keptLocal, uploading])

  return <BookmarksContext value={value}>{children}</BookmarksContext>
}

export function useBookmarks() {
  return useContext(BookmarksContext)
}
