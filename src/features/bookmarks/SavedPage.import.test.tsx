import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import type { Paper, PaperId } from '../../shared/paper'
import { makePaper } from '../discovery/testFixtures'
import { PdsError } from '../repository/client'
import { BookmarkButton } from './BookmarkButton'
import { BookmarksProvider, type BookmarkBackend } from './BookmarksContext'
import type { BrowserBookmarkSource } from './localBookmarks'
import { SavedPage } from './SavedPage'
import type { BookmarkStorage } from './storage'

afterEach(cleanup)

const did = 'did:plc:papertrailtester'
const older = makePaper({ id: 'W1', title: 'Older local paper' })
const newer = makePaper({ id: 'W2', title: 'Newer local paper' })

/** Account storage plus browser bookmarks, mirroring the signed-in PDS backend. */
function accountBackend(options: {
  local?: Paper[]
  keptLocal?: boolean
  failSaveOf?: PaperId
  saveError?: Error
  /** Saves wait until `releaseSave()` is called. */
  holdSaves?: boolean
  failBrowserRemove?: boolean
} = {}) {
  const account: Paper[] = []
  const local = [...(options.local ?? [])]
  let keptLocal = options.keptLocal ?? false
  const held: (() => void)[] = []
  const storage: BookmarkStorage = {
    async listSavedPapers() { return [...account] },
    async savePaper(paper) {
      if (options.holdSaves) await new Promise<void>((resolve) => held.push(resolve))
      if (options.saveError) throw options.saveError
      if (paper.id === options.failSaveOf) throw new PdsError('network', 'offline')
      account.unshift(paper)
    },
    async removeSavedPaper(id) { account.splice(account.findIndex((paper) => paper.id === id) >>> 0, 1) },
  }
  const source: BrowserBookmarkSource = {
    async list() { return [...local] },
    async remove(id) {
      if (options.failBrowserRemove) throw new Error('QuotaExceededError')
      local.splice(local.findIndex((paper) => paper.id === id) >>> 0, 1)
    },
    async isKeptLocal() { return keptLocal },
    async keepLocal() { keptLocal = true },
  }
  const backend: BookmarkBackend = { isLocal: false, create: () => storage, browserBookmarks: () => source }
  return { backend, account, local, isKeptLocal: () => keptLocal, releaseSave: () => held.shift()?.(), heldSaves: () => held.length }
}

function renderWith(ui: ReactNode, backend: BookmarkBackend) {
  return render(
    <MemoryRouter>
      <BookmarksProvider accountDid={did} backend={backend}>{ui}</BookmarksProvider>
    </MemoryRouter>,
  )
}

test('account storage is disclosed as public and nothing uploads without consent', async () => {
  const { backend, account } = accountBackend({ local: [newer, older] })
  renderWith(<SavedPage />, backend)

  expect(await screen.findByRole('heading', { name: 'Bookmarks in this browser' })).toBeTruthy()
  expect(screen.getByText(/You have 2 bookmarks saved only in this browser/).textContent).toContain('public')
  expect(screen.getByText(/saved as public records on your AT Protocol account/)).toBeTruthy()
  expect(account).toEqual([])
})

test('uploading moves browser bookmarks to the account, keeping newest first', async () => {
  const user = userEvent.setup()
  const { backend, account, local } = accountBackend({ local: [newer, older] })
  renderWith(<SavedPage />, backend)

  await user.click(await screen.findByRole('button', { name: 'Upload 2 bookmarks' }))

  expect(await screen.findByText('2 saved papers')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Bookmarks in this browser' })).toBeNull()
  expect(account.map(({ id }) => id)).toEqual(['W2', 'W1'])
  expect(local).toEqual([])
  const titles = screen.getAllByRole('link').map((link) => link.textContent)
  expect(titles.indexOf('Newer local paper')).toBeLessThan(titles.indexOf('Older local paper'))
})

test('keeping bookmarks private keeps them listed, with a way to upload later', async () => {
  const user = userEvent.setup()
  const { backend, account, local, isKeptLocal } = accountBackend({ local: [older] })
  const view = renderWith(<SavedPage />, backend)

  await user.click(await screen.findByRole('button', { name: 'Keep in this browser only' }))

  expect(isKeptLocal()).toBe(true)
  expect(local).toEqual([older])
  expect(account).toEqual([])
  expect(screen.getByRole('heading', { name: 'Bookmarks in this browser' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Older local paper' }).getAttribute('href')).toBe('/papers/W1')
  expect(screen.getByText(/stays private to this browser/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Keep in this browser only' })).toBeNull()

  // The choice persists, and the bookmark can still be uploaded later.
  view.unmount()
  renderWith(<SavedPage />, backend)
  expect(await screen.findByRole('link', { name: 'Older local paper' })).toBeTruthy()
  expect(screen.getByText(/stays private to this browser/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Upload 1 bookmark' }))

  expect(await screen.findByText('1 saved paper')).toBeTruthy()
  expect(account).toEqual([older])
  expect(local).toEqual([])
  expect(screen.queryByRole('heading', { name: 'Bookmarks in this browser' })).toBeNull()
})

test('browser bookmarks can be removed from the saved page', async () => {
  const user = userEvent.setup()
  const { backend, account, local } = accountBackend({ local: [newer, older], keptLocal: true })
  renderWith(<SavedPage />, backend)

  await user.click(await screen.findByRole('button', { name: 'Remove “Older local paper” from saved papers' }))

  expect(local).toEqual([newer])
  expect(account).toEqual([])
  expect(screen.queryByRole('link', { name: 'Older local paper' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Newer local paper' })).toBeTruthy()
})

test('the details button shows browser bookmarks as saved and removes them from the browser', async () => {
  const user = userEvent.setup()
  const { backend, account, local } = accountBackend({ local: [older], keptLocal: true })
  renderWith(<BookmarkButton paper={older} />, backend)

  await user.click(await screen.findByRole('button', { name: 'Bookmarked' }))

  expect(await screen.findByRole('button', { name: 'Bookmark' })).toBeTruthy()
  expect(local).toEqual([])
  expect(account).toEqual([])
})

test('a failed upload keeps what succeeded and offers the rest again', async () => {
  const user = userEvent.setup()
  const { backend, account, local } = accountBackend({ local: [newer, older], failSaveOf: 'W2' })
  renderWith(<SavedPage />, backend)

  await user.click(await screen.findByRole('button', { name: 'Upload 2 bookmarks' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t reach your account’s server')
  expect(account.map(({ id }) => id)).toEqual(['W1'])
  expect(local).toEqual([newer])
  expect(screen.getByRole('button', { name: 'Upload 1 bookmark' })).toBeTruthy()
})

test('missing permission tells the user to sign in again', async () => {
  const user = userEvent.setup()
  const { backend } = accountBackend({ saveError: new PdsError('permission', 'InsufficientScope', 403, 'InsufficientScope') })
  renderWith(<BookmarkButton paper={makePaper()} />, backend)

  await user.click(await screen.findByRole('button', { name: 'Bookmark' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Sign out and sign in again')
  expect(screen.getByText('Bookmarks are public on your AT Protocol account.')).toBeTruthy()
})

test('switching accounts mid-upload stops the upload and keeps it out of the new account', async () => {
  const user = userEvent.setup()
  const { backend, account, local } = accountBackend({ local: [newer, older] })
  const other = accountBackend()
  const storage = backend.create(did)
  let saveCalls = 0
  let finishFirstSave = () => {}
  const slowStorage: BookmarkStorage = {
    ...storage,
    savePaper(paper) {
      saveCalls += 1
      return new Promise<void>((resolve) => {
        finishFirstSave = () => { void storage.savePaper(paper).then(resolve) }
      })
    },
  }
  const switching: BookmarkBackend = {
    isLocal: false,
    create: (account) => (account === did ? slowStorage : other.backend.create(account)),
    browserBookmarks: (account) => (account === did ? backend.browserBookmarks!(account) : other.backend.browserBookmarks!(account)),
  }
  const page = (accountDid: string) => (
    <MemoryRouter>
      <BookmarksProvider accountDid={accountDid} backend={switching}><SavedPage /></BookmarksProvider>
    </MemoryRouter>
  )

  const view = render(page(did))
  await user.click(await screen.findByRole('button', { name: 'Upload 2 bookmarks' }))
  await screen.findByRole('button', { name: 'Uploading…' })

  view.rerender(page('did:plc:secondaccount'))
  await screen.findByText(/haven’t bookmarked any papers yet/)
  finishFirstSave()

  // The finished upload is cleared from the first account's browser list...
  await waitFor(() => expect(local).toEqual([newer]))
  expect(account.map(({ id }) => id)).toEqual(['W1'])
  // ...but the loop stops, and nothing leaks into the second account's page.
  expect(saveCalls).toBe(1)
  expect(screen.queryByRole('link', { name: 'Older local paper' })).toBeNull()
  expect(screen.getByText(/haven’t bookmarked any papers yet/)).toBeTruthy()
})

test('a bookmark removed while the upload is queued is not uploaded', async () => {
  const user = userEvent.setup()
  const third = makePaper({ id: 'W3', title: 'Newest local paper' })
  const { backend, account, local, releaseSave, heldSaves } = accountBackend({ local: [third, newer, older], holdSaves: true })
  renderWith(<SavedPage />, backend)

  await user.click(await screen.findByRole('button', { name: 'Upload 3 bookmarks' }))
  await waitFor(() => expect(heldSaves()).toBe(1))

  // The paper being saved can't be removed mid-save; a queued one can.
  expect((screen.getByRole('button', { name: 'Remove “Older local paper” from saved papers' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Remove “Newer local paper” from saved papers' }))
  expect(local.map(({ id }) => id)).toEqual(['W3', 'W1'])

  releaseSave()
  await waitFor(() => expect(heldSaves()).toBe(1))
  releaseSave()

  await waitFor(() => expect(local).toEqual([]))
  expect(account.map(({ id }) => id)).toEqual(['W3', 'W1'])
  expect(await screen.findByText('2 saved papers')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Newer local paper' })).toBeNull()
})

test('a failed browser cleanup still shows the uploaded bookmark on the account', async () => {
  const user = userEvent.setup()
  const { backend, account, local } = accountBackend({ local: [newer, older], failBrowserRemove: true })
  renderWith(<SavedPage />, backend)

  await user.click(await screen.findByRole('button', { name: 'Upload 2 bookmarks' }))

  expect(await screen.findByText('2 saved papers')).toBeTruthy()
  expect(account.map(({ id }) => id)).toEqual(['W2', 'W1'])
  // The browser copies are kept, but hidden because both papers are on the account now.
  expect(local).toEqual([newer, older])
  expect(screen.queryByRole('heading', { name: 'Bookmarks in this browser' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})
