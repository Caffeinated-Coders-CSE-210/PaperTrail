import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import type { Paper } from '../../shared/paper'
import { makePaper } from '../discovery/testFixtures'
import { BookmarkButton } from './BookmarkButton'
import { BookmarksProvider, type BookmarkBackend } from './BookmarksContext'
import { SavedPage } from './SavedPage'
import type { BookmarkStorage } from './storage'

afterEach(cleanup)

const did = 'did:plc:papertrailtester'

function memoryBackend(initial: Paper[] = [], options: { failWrites?: boolean; failLoad?: boolean } = {}) {
  const papers = [...initial]
  const storage: BookmarkStorage = {
    async listSavedPapers() {
      if (options.failLoad) throw new Error('offline')
      return [...papers]
    },
    async savePaper(paper) {
      if (options.failWrites) throw new Error('offline')
      if (!papers.some((saved) => saved.id === paper.id)) papers.unshift(paper)
    },
    async removeSavedPaper(id) {
      if (options.failWrites) throw new Error('offline')
      papers.splice(papers.findIndex((saved) => saved.id === id) >>> 0, 1)
    },
  }
  const backend: BookmarkBackend = { isLocal: true, create: () => storage }
  return { backend, papers }
}

function renderWith(ui: ReactNode, backend: BookmarkBackend, accountDid: string | null = did) {
  return render(
    <MemoryRouter>
      <BookmarksProvider accountDid={accountDid} backend={backend}>{ui}</BookmarksProvider>
    </MemoryRouter>,
  )
}

test('a synchronous storage creation failure shows an error and keeps children rendered', async () => {
  const backend: BookmarkBackend = { isLocal: true, create() { throw new Error('SecurityError') } }
  renderWith(<><p>Provider children remain rendered</p><BookmarkButton paper={makePaper()} /></>, backend)
  expect(screen.getByText('Provider children remain rendered')).toBeTruthy()
  expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded')
})

test('retry recreates storage after synchronous creation failure', async () => {
  const user = userEvent.setup()
  const { backend: storageBackend } = memoryBackend()
  let attempts = 0
  const backend: BookmarkBackend = {
    isLocal: true,
    create(did) {
      attempts += 1
      if (attempts === 1) throw new Error('SecurityError')
      return storageBackend.create(did)
    },
  }
  renderWith(<BookmarkButton paper={makePaper()} />, backend)
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: 'Bookmark' })).toBeTruthy()
  expect(attempts).toBe(2)
})

test('signed-out users are asked to sign in instead of seeing the button', () => {
  renderWith(<BookmarkButton paper={makePaper()} />, memoryBackend().backend, null)
  expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

test('bookmarking and removing updates the button state and storage', async () => {
  const user = userEvent.setup()
  const { backend, papers } = memoryBackend()
  renderWith(<BookmarkButton paper={makePaper()} />, backend)

  const button = await screen.findByRole('button', { name: 'Bookmark' })
  expect(button.getAttribute('aria-pressed')).toBe('false')
  await user.click(button)

  const saved = await screen.findByRole('button', { name: 'Bookmarked' })
  expect(saved.getAttribute('aria-pressed')).toBe('true')
  expect(papers.map(({ id }) => id)).toEqual(['W123'])
  expect(screen.getByText('Bookmarks are saved in this browser only.')).toBeTruthy()

  await user.click(saved)
  await screen.findByRole('button', { name: 'Bookmark' })
  expect(papers).toEqual([])
})

test('an already-saved paper shows as bookmarked on load', async () => {
  renderWith(<BookmarkButton paper={makePaper()} />, memoryBackend([makePaper()]).backend)
  expect((await screen.findByRole('button', { name: 'Bookmarked' })).getAttribute('aria-pressed')).toBe('true')
})

test('a failed save shows an error and leaves the paper unbookmarked', async () => {
  const user = userEvent.setup()
  renderWith(<BookmarkButton paper={makePaper()} />, memoryBackend([], { failWrites: true }).backend)
  await user.click(await screen.findByRole('button', { name: 'Bookmark' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Could not bookmark this paper. Try again.')
  expect(screen.getByRole('button', { name: 'Bookmark' }).getAttribute('aria-pressed')).toBe('false')
})

test('a failed load offers a retry', async () => {
  renderWith(<BookmarkButton paper={makePaper()} />, memoryBackend([], { failLoad: true }).backend)
  expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded')
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
})

test('the saved page lists bookmarks and shares state with the button', async () => {
  const user = userEvent.setup()
  const other = makePaper({ id: 'W456', title: 'Another paper', authors: [] })
  renderWith(
    <><BookmarkButton paper={makePaper()} /><SavedPage /></>,
    memoryBackend([other]).backend,
  )

  expect((await screen.findByRole('link', { name: 'Another paper' })).getAttribute('href')).toBe('/papers/W456')
  expect(screen.getByText('Unknown authors · 2024')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Bookmark' }))
  expect(await screen.findByRole('link', { name: 'Learning to browse research' })).toBeTruthy()
  expect(screen.getByText('2 saved papers')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Remove “Learning to browse research” from saved papers' }))
  expect(await screen.findByRole('button', { name: 'Bookmark' })).toBeTruthy()
  expect(screen.getByText('1 saved paper')).toBeTruthy()
})

test('the saved page shows an empty state', async () => {
  renderWith(<SavedPage />, memoryBackend().backend)
  expect(await screen.findByText(/haven’t bookmarked any papers yet/)).toBeTruthy()
})
