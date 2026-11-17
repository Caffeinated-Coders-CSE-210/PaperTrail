import { isValidHandle } from '@atproto/syntax'

/** UI-facing identity. The auth service owns the SDK session and authorized client. */
export interface Identity {
  did: string
  handle: string | null
  displayName?: string | null
}

export interface AuthService {
  restoreSession(): Promise<Identity | null>
  signIn(handle: string): Promise<void>
  signOut(): Promise<void>
}

export class InvalidHandleError extends Error {}

interface OAuthSession {
  did: string
  signOut(): Promise<void>
}

interface OAuthClient {
  init(): Promise<{ session: OAuthSession } | undefined>
  signIn(handle: string): Promise<unknown>
}

type SessionEndedListener = () => void
type Profile = Pick<Identity, 'handle' | 'displayName'>

export interface SessionAuthService extends AuthService {
  onSessionEnded(listener: SessionEndedListener): () => void
}

export function createAuthService<Client extends OAuthClient>(
  createClient: (onSessionDeleted: (did: string) => void) => Promise<Client>,
  loadProfile: (did: string, client: Client) => Promise<Profile>,
): SessionAuthService {
  const listeners = new Set<SessionEndedListener>()
  let client: Promise<Client> | undefined
  let restoration: Promise<Identity | null> | undefined
  let activeSession: OAuthSession | undefined

  function sessionEnded(did: string) {
    if (activeSession?.did !== did) return
    activeSession = undefined
    restoration = Promise.resolve(null)
    listeners.forEach((listener) => listener())
  }

  function getClient() {
    return client ??= createClient(sessionEnded).catch((error: unknown) => {
      client = undefined
      throw error
    })
  }

  async function restore() {
    const oauth = await getClient()
    const result = await oauth.init()
    if (!result) return null

    const { session } = result
    const { did } = session
    activeSession = session
    const profile = await loadProfile(did, oauth).catch(() => ({
      handle: null,
      displayName: null,
    }))
    return activeSession === session ? { did, ...profile } : null
  }

  return {
    restoreSession() {
      // In StrictMode the startup effect runs twice. Consume the OAuth callback once.
      return restoration ??= restore()
    },
    async signIn(input) {
      const handle = input.trim().replace(/^@/, '').toLowerCase()
      if (!isValidHandle(handle)) {
        throw new InvalidHandleError('Enter a valid AT Protocol handle, such as reader.bsky.social.')
      }
      await (await getClient()).signIn(handle)
    },
    async signOut() {
      const session = activeSession
      if (!session) return
      try {
        await session.signOut()
      } finally {
        sessionEnded(session.did)
      }
    },
    onSessionEnded(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
