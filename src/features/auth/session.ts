/** UI-facing identity. The auth service owns the SDK session and authorized client. */
export interface Identity {
  did: string
  handle: string | null
}

export interface AuthService {
  restoreSession(): Promise<Identity | null>
  signIn(handle: string): Promise<void>
  signOut(): Promise<void>
}
