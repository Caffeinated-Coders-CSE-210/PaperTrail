import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { browserAuth } from './browserAuth'
import { InvalidHandleError, type Identity } from './session'

type AuthOperation = 'restore' | 'sign-in' | 'sign-out'

interface AuthContextValue {
  identity: Identity | null
  pending: AuthOperation | null
  error: string | null
  signIn(handle: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [pending, setPending] = useState<AuthOperation | null>('restore')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const unsubscribe = browserAuth.onSessionEnded(() => setIdentity(null))

    void browserAuth.restoreSession().then(
      (restored) => { if (mounted) setIdentity(restored) },
      () => { if (mounted) setError('Could not complete sign-in or restore your session. Try signing in again.') },
    ).finally(() => {
      if (mounted) setPending(null)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  async function signIn(handle: string) {
    if (pending || identity) return
    setPending('sign-in')
    setError(null)
    try {
      await browserAuth.signIn(handle)
    } catch (error) {
      setError(error instanceof InvalidHandleError
        ? error.message
        : 'Could not sign in. Check your handle and try again.')
    } finally {
      setPending(null)
    }
  }

  async function signOut() {
    if (pending || !identity) return
    setPending('sign-out')
    setError(null)
    try {
      await browserAuth.signOut()
    } catch {
      setError('Signed out of PaperTrail. Your provider could not confirm that access was revoked.')
    } finally {
      setPending(null)
    }
  }

  return (
    <AuthContext.Provider value={{ identity, pending, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used within AuthProvider')
  return auth
}
