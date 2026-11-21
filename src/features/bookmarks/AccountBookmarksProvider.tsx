import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { BookmarksProvider } from './BookmarksContext'

/** Connects bookmarks to the signed-in AT Protocol account. Mount inside `AuthProvider`. */
export function AccountBookmarksProvider({ children }: { children: ReactNode }) {
  const { identity, pending } = useAuth()
  return (
    <BookmarksProvider accountDid={identity?.did ?? null} authPending={pending === 'restore'}>
      {children}
    </BookmarksProvider>
  )
}
