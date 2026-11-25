import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { useAuth } from '../auth/AuthProvider'
import { SharePaper } from './SharePaper'

vi.mock('../auth/AuthProvider', () => ({ useAuth: vi.fn() }))
type Auth = ReturnType<typeof useAuth>
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const url = 'https://openalex.org/W7'
const cid = 'bafkreibjfgx2gprinfvicegelk5kosd6y2frmqpqzwqkg7usac74l3t2v4'
const view = () => <MemoryRouter><SharePaper title="Shared research" url={url} /></MemoryRouter>
const account = (fetchHandler: Auth['fetchHandler'], accountDid = did): Auth => ({
  identity: { did: accountDid, handle: 'reader.test' }, fetchHandler, pending: null,
  error: null, signIn: async () => {}, signOut: async () => {},
})
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks() })

for (const [status, error] of [[401, 'AuthenticationRequired'], [403, 'Forbidden'], [403, 'InsufficientScope']] as const) {
  test(`reauthorization after ${error} retains the original post across remounts`, async () => {
    let original: { repo: string; rkey: string; record: unknown } | undefined
    vi.mocked(useAuth).mockReturnValue(account(async (_path, init) => {
      original = JSON.parse(init!.body as string)
      return Response.json({ error }, { status })
    }))
    const first = render(view())
    fireEvent.click(screen.getByRole('button', { name: 'Share to Bluesky' }))
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'My original comment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post to Bluesky' }))
    await screen.findByRole('alert')

    vi.mocked(useAuth).mockReturnValue({ ...account(null), identity: null, pending: 'sign-in' })
    first.rerender(view())
    first.unmount() // Home navigation / OAuth redirect destroys the entire details page.
    vi.mocked(useAuth).mockReturnValue(account(async () => { throw new Error('Unexpected request') }, 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'))
    const otherAccount = render(view())
    expect(screen.getByRole('button', { name: 'Share to Bluesky' })).toBeTruthy()
    otherAccount.unmount()
    const retried: unknown[] = []
    vi.mocked(useAuth).mockReturnValue(account(async (path, init) => {
      if (path.includes('createRecord')) {
        const write = JSON.parse(init!.body as string)
        retried.push(write)
        return Response.json({ error: 'RecordAlreadyExists' }, { status: 400 })
      }
      expect(new URL(path, 'https://pds.test').searchParams.get('rkey')).toBe(original!.rkey)
      return Response.json({ uri: `at://${did}/app.bsky.feed.post/${original!.rkey}`, cid, value: original!.record })
    }))
    render(view())
    expect((screen.getByLabelText('Post text') as HTMLTextAreaElement).value).toBe('My original comment')
    fireEvent.click(screen.getByRole('button', { name: 'Retry post' }))
    await screen.findByRole('link', { name: 'View post' })
    expect(retried).toEqual([{ ...original, collection: 'app.bsky.feed.post' }])
    cleanup()
    render(view())
    expect(screen.getByRole('button', { name: 'Share to Bluesky' })).toBeTruthy()
  })
}

test('explicit discard starts a new attempt instead of reusing the uncertain post', async () => {
  const keys: string[] = []
  vi.mocked(useAuth).mockReturnValue(account(async (_path, init) => {
    keys.push(JSON.parse(init!.body as string).rkey)
    return Response.json({ error: 'InsufficientScope' }, { status: 403 })
  }))
  render(view())
  fireEvent.click(screen.getByRole('button', { name: 'Share to Bluesky' }))
  fireEvent.click(screen.getByRole('button', { name: 'Post to Bluesky' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Discard attempt' }))
  cleanup()
  render(view())
  fireEvent.click(screen.getByRole('button', { name: 'Share to Bluesky' }))
  fireEvent.click(screen.getByRole('button', { name: 'Post to Bluesky' }))
  await screen.findByRole('alert')
  expect(keys).toHaveLength(2)
  expect(keys[1]).not.toBe(keys[0])
})

test('unavailable recovery storage prevents sending and explains how to recover', async () => {
  let writes = 0
  vi.mocked(useAuth).mockReturnValue(account(async () => { writes++; throw new Error('Should not send') }))
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked') })
  render(view())
  fireEvent.click(screen.getByRole('button', { name: 'Share to Bluesky' }))
  fireEvent.click(screen.getByRole('button', { name: 'Post to Bluesky' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Enable session storage')
  expect(writes).toBe(0)
})
