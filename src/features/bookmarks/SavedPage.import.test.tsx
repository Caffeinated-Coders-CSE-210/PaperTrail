import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import type { Paper, PaperId } from '../../shared/paper'
import { makePaper } from '../discovery/testFixtures'
import { PdsError } from '../repository/client'
import { BookmarkButton } from './BookmarkButton'
import { BookmarksProvider, type BookmarkBackend } from './BookmarksContext'
import type { BookmarkImportSource } from './localBookmarks'
import { SavedPage } from './SavedPage'
import type { BookmarkStorage } from './storage'

afterEach(cleanup)

const did = 'did:plc:papertrailtester'
const older = makePaper({ id: 'W1', title: 'Older local paper' })
const newer = makePaper({ id: 'W2', title: 'Newer local paper' })

/** Account storage plus browser bookmarks, mirroring the signed-in PDS backend. */
function accountBackend(options: { local?: Paper[]; failSaveOf?: PaperId; saveError?: Error } = {}) {
  const account: Paper[] = []
  const local = [...(options.local ?? [])]
  let keptLocal = false
  const storage: BookmarkStorage = {
    async listSavedPapers() { return [...account] },
    async savePaper(paper) {
      if (options.saveError) throw options.saveError
      if (paper.id === options.failSaveOf) throw new PdsError('network', 'offline')
      account.unshift(paper)
    },
    async removeSavedPaper(id) { account.splice(account.findIndex((paper) => paper.id === id) >>> 0, 1) },
  }
  const source: BookmarkImportSource = {
    async listPending() { return keptLocal ? [] : [...local] },
    async markUploaded(id) { local.splice(local.findIndex((paper) => paper.id === id) >>> 0, 1) },
    async keepLocal() { keptLocal = true },
  }
  const backend: BookmarkBackend = { isLocal: false, create: () => storage, importSource: () => source }
  return { backend, account, local, isKeptLocal: () => keptLocal }
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

test('keeping bookmarks private leaves them in the browser and hides the offer', async () => {
  const user = userEvent.setup()
  const { backend, account, local, isKeptLocal } = accountBackend({ local: [older] })
  renderWith(<SavedPage />, backend)

  await user.click(await screen.findByRole('button', { name: 'Keep in this browser only' }))

  expect(screen.queryByRole('heading', { name: 'Bookmarks in this browser' })).toBeNull()
  expect(isKeptLocal()).toBe(true)
  expect(local).toEqual([older])
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
