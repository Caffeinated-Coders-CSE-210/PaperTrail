import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from './AuthProvider'
import './auth.css'

export function HomePage() {
  const { identity, pending, error, signIn, signOut } = useAuth()
  const [handle, setHandle] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void signIn(handle)
  }

  return (
    <>
      <h1>Research notebook</h1>
      <section className="auth-panel" aria-label="Account">
        {pending === 'restore' ? (
          <p role="status">Checking your session…</p>
        ) : identity ? (
          <>
            <p>
              Signed in as <strong>{identity.displayName || identity.handle || identity.did}</strong>
              {identity.displayName && identity.handle && <> (@{identity.handle})</>}
            </p>
            <button type="button" onClick={() => void signOut()} disabled={pending === 'sign-out'}>
              {pending === 'sign-out' ? 'Signing out…' : 'Sign out'}
            </button>
          </>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="auth-handle">AT Protocol handle</label>
            <input
              id="auth-handle"
              name="handle"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="name.bsky.social"
              aria-describedby={error ? 'auth-error' : undefined}
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              disabled={pending === 'sign-in'}
            />
            <button type="submit" disabled={pending === 'sign-in'}>
              {pending === 'sign-in' ? 'Opening sign-in…' : 'Sign in'}
            </button>
          </form>
        )}
        {error && <p className="auth-error" id="auth-error" role="alert">{error}</p>}
      </section>
      <Link to="/search">Explore papers →</Link>
    </>
  )
}
