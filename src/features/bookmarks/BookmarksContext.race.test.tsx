import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import type { Paper } from '../../shared/paper'
import { makePaper } from '../discovery/testFixtures'
import { BookmarkButton } from './BookmarkButton'
import { BookmarksProvider, type BookmarkBackend } from './BookmarksContext'
import type { BookmarkImportSource } from './localBookmarks'
import { SavedPage } from './SavedPage'
import type { BookmarkStorage } from './storage'

afterEach(cleanup)

const first = 'did:plc:firstaccount'
const second = 'did:plc:secondaccount'

/** Storage whose saves wait until the test releases them, counting each attempt. */
function heldStorage() {
  const saved: Paper[] = []
  const releases: (() => void)[] = []
  let saveCalls = 0
  const storage: BookmarkStorage = {
    async listSavedPapers() { return [...saved] },
    savePaper(paper) {
      saveCalls += 1
      return new Promise<void>((resolve) => releases.push(() => { saved.unshift(paper); resolve() }))
    },
    async removeSavedPaper() {},
  }
  return { storage, saved, release: () => releases.shift()?.(), saveCalls: () => saveCalls }
}

function importSource(local: Paper[]): BookmarkImportSource {
  return {
    async listPending() { return [...local] },
    async markUploaded(id) { local.splice(local.findIndex((paper) => paper.id === id) >>> 0, 1) },
    async keepLocal() {},
  }
}

/** Finishes held work during the commit that mounts it, before React runs passive effects. */
function OnCommit({ run }: { run: () => void }) {
  useLayoutEffect(run, [run])
  return null
}

test('an upload cannot start another save in the gap after the new account commits', async () => {
  const actEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  // act() flushes passive effects immediately, which hides the gap, so use React's real scheduler.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  try {
    const held = heldStorage()
    const local = [makePaper({ id: 'W2', title: 'Newer' }), makePaper({ id: 'W1', title: 'Older' })]
    const backend: BookmarkBackend = {
      isLocal: false,
      create: (did) => (did === first ? held.storage : heldStorage().storage),
      importSource: (did) => importSource(did === first ? local : []),
    }
    const page = (did: string, extra?: ReactNode) => (
      <MemoryRouter>
        <BookmarksProvider accountDid={did} backend={backend}><SavedPage />{extra}</BookmarksProvider>
      </MemoryRouter>
    )

    root.render(page(first))
    ;(await screen.findByRole('button', { name: 'Upload 2 bookmarks' })).click()
    await waitFor(() => expect(held.saveCalls()).toBe(1))

    root.render(page(second, <OnCommit run={held.release} />))
    await screen.findByText(/haven’t bookmarked any papers yet/)
    await waitFor(() => expect(local.map(({ id }) => id)).toEqual(['W2']))

    expect(held.saveCalls()).toBe(1)
    expect(held.saved.map(({ id }) => id)).toEqual(['W1'])
  } finally {
    root.unmount()
    container.remove()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = actEnvironment
  }
})

test('an earlier account finishing a save does not clear the new account’s pending state', async () => {
  const user = userEvent.setup()
  const firstHeld = heldStorage()
  const secondHeld = heldStorage()
  const backend: BookmarkBackend = {
    isLocal: false,
    create: (did) => (did === first ? firstHeld.storage : secondHeld.storage),
  }
  const paper = makePaper()
  const button = (did: string) => (
    <MemoryRouter>
      <BookmarksProvider accountDid={did} backend={backend}><BookmarkButton paper={paper} /></BookmarksProvider>
    </MemoryRouter>
  )

  const view = render(button(first))
  await user.click(await screen.findByRole('button', { name: 'Bookmark' }))
  await screen.findByRole('button', { name: 'Saving…' })

  view.rerender(button(second))
  await user.click(await screen.findByRole('button', { name: 'Bookmark' }))
  await screen.findByRole('button', { name: 'Saving…' })

  firstHeld.release()
  await waitFor(() => expect(firstHeld.saved).toHaveLength(1))

  const pending = screen.getByRole('button', { name: 'Saving…' })
  expect((pending as HTMLButtonElement).disabled).toBe(true)

  secondHeld.release()
  expect(await screen.findByRole('button', { name: 'Bookmarked' })).toBeTruthy()
})
