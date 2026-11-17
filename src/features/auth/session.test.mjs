import assert from 'node:assert/strict'
import test from 'node:test'
import * as auth from './session.ts'

const did = 'did:plc:papertrailtestaccount'
const handle = 'reader.example.org'

function setup(options = {}) {
  assert.equal(typeof auth.createAuthService, 'function', 'The auth service must be available to React')
  let deleteSession
  const client = {
    init: async () => ({ session: { did, signOut: async () => {} } }),
    signIn: async () => { throw new Error('Unexpected sign-in') },
    ...options.client,
  }
  const service = auth.createAuthService(
    async (onSessionDeleted) => {
      deleteSession = onSessionDeleted
      return client
    },
    options.loadProfile ?? (async () => ({ handle, displayName: 'Paper Reader' })),
  )
  return { service, deleteSession: (id) => deleteSession(id) }
}

test('initializes OAuth once when two callers restore during app startup', async () => {
  let attempts = 0
  const { service } = setup({
    client: {
      async init() {
        assert.equal(++attempts, 1, 'A callback can only be consumed once')
        return { session: { did, signOut: async () => {} } }
      },
    },
  })
  const [first, second] = await Promise.all([service.restoreSession(), service.restoreSession()])
  const identity = { did, handle, displayName: 'Paper Reader' }
  assert.deepEqual(first, identity)
  assert.deepEqual(second, identity)
})

test('a clean startup without a session returns a signed-out identity', async () => {
  const { service } = setup({ client: { init: async () => undefined } })
  assert.equal(await service.restoreSession(), null)
})

test('keeps the authenticated DID when profile lookup fails', async () => {
  const { service } = setup({ loadProfile: async () => { throw new Error('Profile unavailable') } })
  assert.deepEqual(await service.restoreSession(), { did, handle: null, displayName: null })
})

test('rejects a failed OAuth callback so the UI can show a sign-in error', async () => {
  const { service } = setup({ client: { init: async () => { throw new Error('Access denied') } } })
  await assert.rejects(service.restoreSession(), /Access denied/)
})

test('normalizes the entered handle before starting OAuth', async () => {
  let authorizedHandle
  const { service } = setup({
    client: { signIn: async (value) => { authorizedHandle = value } },
  })
  await service.signIn('  @Reader.Example.org  ')
  assert.equal(authorizedHandle, 'reader.example.org')
})

test('rejects identifiers that are not handles before starting OAuth', async () => {
  const { service } = setup()
  await assert.rejects(service.signIn('https://reader.example.org'), /valid.*handle/i)
})

test('signing out in an older tab preserves the newer account for refresh', async () => {
  const secondAccount = 'did:plc:anotheraccount'
  let lastSignedIn = did
  const savedSessions = new Set([did, secondAccount])
  const { service } = setup({
    client: {
      init: async () => ({
        session: {
          did,
          async signOut() {
            savedSessions.delete(did)
            if (lastSignedIn === did) lastSignedIn = null
          },
        },
      }),
      async revoke(id) {
        lastSignedIn = null
        savedSessions.delete(id)
      },
    },
  })

  await service.restoreSession()
  lastSignedIn = secondAccount
  await service.signOut()

  assert.equal(await service.restoreSession(), null)
  assert.equal(savedSessions.has(did), false)
  assert.equal(lastSignedIn, secondAccount)
  assert.equal(savedSessions.has(secondAccount), true)
})

test('an SDK deletion clears only the matching active account', async () => {
  const { service, deleteSession } = setup()
  let cleared = 0
  service.onSessionEnded(() => { cleared += 1 })
  await service.restoreSession()
  deleteSession('did:plc:anotheraccount')
  assert.equal(cleared, 0)
  deleteSession(did)
  assert.equal(cleared, 1)
  assert.equal(await service.restoreSession(), null)
})

test('a session deleted during profile lookup is not restored', async () => {
  let finishProfile
  let profileStarted
  const started = new Promise((resolve) => { profileStarted = resolve })
  const { service, deleteSession } = setup({
    loadProfile: () => new Promise((resolve) => {
      finishProfile = resolve
      profileStarted()
    }),
  })
  const restoration = service.restoreSession()
  await started
  deleteSession(did)
  finishProfile({ handle, displayName: 'Paper Reader' })
  assert.equal(await restoration, null)
})
