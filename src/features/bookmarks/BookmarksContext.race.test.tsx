import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useLayoutEffect, type ReactNode } from 'react'
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

function importSource(local: Paper[], onMarkUploaded = () => {}): BookmarkImportSource {
  return {
    async listPending() { return [...local] },
    async markUploaded(id) {
      onMarkUploaded()
      local.splice(local.findIndex((paper) => paper.id === id) >>> 0, 1)
    },
    async keepLocal() {},
  }
}

/**
 * Releases held work in a layout effect during the commit that mounts it, and reports when that commit's
 * passive effects run. As a child of the provider, its passive effect runs before the provider's.
 */
function OnCommit({ run, onPassive }: { run: () => void; onPassive: () => void }) {
  useLayoutEffect(run, [run])
  useEffect(onPassive, [onPassive])
  return null
}

test('an upload cannot start another save in the gap after the new account commits', async () => {
  const actEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  // act() flushes passive effects before returning, which closes the gap, so use React's real scheduler.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  try {
    const held = heldStorage()
    const local = [makePaper({ id: 'W2', title: 'Newer' }), makePaper({ id: 'W1', title: 'Older' })]
    let passiveRan = false
    let resumedBeforePassive: boolean | null = null
    const backend: BookmarkBackend = {
      isLocal: false,
      create: (did) => (did === first ? held.storage : heldStorage().storage),
      // The loop calls markUploaded as soon as the held save resolves, before checking the account.
      importSource: (did) => importSource(did === first ? local : [], () => { resumedBeforePassive ??= !passiveRan }),
    }
    const page = (did: string, extra?: ReactNode) => (
      <MemoryRouter>
        <BookmarksProvider accountDid={did} backend={backend}><SavedPage />{extra}</BookmarksProvider>
      </MemoryRouter>
    )

    root.render(page(first))
    ;(await screen.findByRole('button', { name: 'Upload 2 bookmarks' })).click()
    await waitFor(() => expect(held.saveCalls()).toBe(1))

    root.render(page(second, <OnCommit run={held.release} onPassive={() => { passiveRan = true }} />))
    await screen.findByText(/haven’t bookmarked any papers yet/)
    await waitFor(() => expect(local.map(({ id }) => id)).toEqual(['W2']))

    // Precondition: the loop resumed inside the gap, after the commit but before its passive effects.
    // With React 19.3.1, a default-priority root.render() commits in a scheduler task and schedules passive
    // effects for a later task, so the microtask continuation runs first. If that ever changes, this fails
    // loudly instead of letting the assertions below pass without exercising the race.
    expect(resumedBeforePassive, 'upload must resume before passive effects run').toBe(true)

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
