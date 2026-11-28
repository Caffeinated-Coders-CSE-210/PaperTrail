import { PdsError } from '../repository/client.ts'

/** Explains failures the user can act on; anything else gets the caller's fallback. */
export function bookmarkErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof PdsError)) return fallback
  switch (error.code) {
    case 'permission':
      return 'PaperTrail doesn’t have permission to update your bookmarks. Sign out and sign in again to grant it.'
    case 'authentication':
      return 'Your session has expired. Sign in again to manage your bookmarks.'
    case 'network':
      return 'Couldn’t reach your account’s server. Check your connection and try again.'
    case 'rate-limit':
      return 'Too many requests. Wait a moment and try again.'
    default:
      return fallback
  }
}
