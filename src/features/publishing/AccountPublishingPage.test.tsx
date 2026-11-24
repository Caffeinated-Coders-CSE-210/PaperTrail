import { Suspense, createContext, startTransition, useContext, useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { useAuth } from '../auth/AuthProvider'
import * as publications from './service'
import type { PublicationSession } from './service'
import { AccountPublishingPage } from './AccountPublishingPage'

vi.mock('../auth/AuthProvider', () => ({ useAuth: vi.fn() }))
type Auth = ReturnType<typeof useAuth>
const AuthContext = createContext<Auth | null>(null)
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('an abandoned auth render cannot invalidate the committed publishing session', async () => {
  const account: Auth = {
    identity: { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', handle: 'alice.test' }, pending: null, error: null,
    fetchHandler: async () => Response.json({ records: [] }), signIn: async () => {}, signOut: async () => {},
  }
  const other: Auth = { ...account, identity: { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', handle: 'bob.test' } }
  vi.mocked(useAuth).mockImplementation(() => useContext(AuthContext)!)
  const sessions: PublicationSession[] = []
  const create = publications.createPublicationService
  vi.spyOn(publications, 'createPublicationService').mockImplementation((session, dependencies) => {
    if (session) sessions.push(session)
    return create(session, dependencies)
  })
  const suspended = new Promise<never>(() => {})
  let update: (value: Auth) => void = () => { throw new Error('Harness not mounted') }
  function SuspendOtherAccount() {
    if (useContext(AuthContext)?.identity?.did === other.identity?.did) throw suspended
    return null
  }
  function Harness() {
    const [auth, setAuth] = useState(account)
    update = setAuth
    return <AuthContext.Provider value={auth}><Suspense fallback={<p>Switching account…</p>}>
      <AccountPublishingPage view="list" /><SuspendOtherAccount />
    </Suspense></AuthContext.Provider>
  }
  render(<MemoryRouter><Harness /></MemoryRouter>)
  await screen.findByText('You have not published any papers yet.')
  const committed = sessions[0]
  expect(committed.isActive()).toBe(true)
  await act(async () => { startTransition(() => update(other)) })
  expect(sessions.some(session => session.did === other.identity?.did)).toBe(true)
  expect(committed.isActive()).toBe(true)
  // A real committed auth transition must still invalidate the old session.
  await act(async () => { update({ ...account, pending: 'sign-out' }) })
  expect(committed.isActive()).toBe(false)
})
