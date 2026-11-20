import { useMemo, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { LikesProvider } from './LikesContext'
import { createPdsLikeStore } from './pdsLikes'

/** Connects likes to the signed-in AT Protocol account. Mount inside `AuthProvider`. */
export function AccountLikesProvider({ children }: { children: ReactNode }) {
  const { identity, pending, fetchHandler } = useAuth()
  const did = identity?.did
  const store = useMemo(
    () => (did && fetchHandler ? createPdsLikeStore(did, fetchHandler) : null),
    [did, fetchHandler],
  )
  return <LikesProvider store={store} authPending={pending === 'restore'}>{children}</LikesProvider>
}
