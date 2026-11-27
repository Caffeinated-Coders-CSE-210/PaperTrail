import { useMemo, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { FetchHandler } from '../auth/session'
import { createRepositoryClient } from '../repository/client'
import { BookmarksProvider, localBookmarkBackend, type BookmarkBackend } from './BookmarksContext'
import { createLocalImportSource } from './localBookmarks'
import { createPdsBookmarkStorage } from './pdsBookmarks'

/** Signed-in bookmarks live in the account's PDS. Older browser bookmarks are offered for upload. */
export function pdsBookmarkBackend(fetchHandler: FetchHandler): BookmarkBackend {
  return {
    isLocal: false,
    create: (did) => createPdsBookmarkStorage(createRepositoryClient(did, fetchHandler)),
    importSource: (did) => createLocalImportSource(did),
  }
}

/** Connects bookmarks to the signed-in AT Protocol account. Mount inside `AuthProvider`. */
export function AccountBookmarksProvider({ children }: { children: ReactNode }) {
  const { identity, pending, fetchHandler } = useAuth()
  const backend = useMemo(
    () => (fetchHandler ? pdsBookmarkBackend(fetchHandler) : localBookmarkBackend),
    [fetchHandler],
  )
  return (
    <BookmarksProvider accountDid={identity?.did ?? null} authPending={pending === 'restore'} backend={backend}>
      {children}
    </BookmarksProvider>
  )
}
