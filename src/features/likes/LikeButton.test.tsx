import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import type { PaperId } from '../../shared/paper'
import { LikeButton } from './LikeButton'
import { LikeCount } from './LikeCount'
import { LikesProvider } from './LikesContext'
import { LikePermissionError } from './pdsLikes'
import type { LikeCounter, LikeStore } from './service'

afterEach(cleanup)

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeStore(overrides: Partial<LikeStore> = {}): LikeStore {
  return {
    hasLiked: vi.fn(async () => false),
    like: vi.fn(async () => {}),
    unlike: vi.fn(async () => {}),
    ...overrides,
  }
}

function fakeCounter(count = 3): LikeCounter {
  return { countLikes: vi.fn(async () => count) }
}

interface Props {
  store?: LikeStore | null
  counter?: LikeCounter
  authPending?: boolean
  paperId?: PaperId
  withCount?: boolean
}

function tree({ store = null, counter = fakeCounter(), authPending = false, paperId = 'W123', withCount = false }: Props) {
  return (
    <MemoryRouter>
      <LikesProvider store={store} counter={counter} authPending={authPending}>
        <LikeButton paperId={paperId} />
        {withCount && <div data-testid="card"><LikeCount paperId={paperId} /></div>}
      </LikesProvider>
    </MemoryRouter>
  )
}

function setup(props: Props = {}) {
  const resolved = { store: fakeStore() as LikeStore | null, counter: fakeCounter(), ...props }
  const { rerender } = render(tree(resolved))
  return {
    ...resolved,
    user: userEvent.setup(),
    rerender: (next: Props) => rerender(tree({ ...resolved, ...next })),
  }
}

function likeButton() {
  return screen.getByRole('button', { name: /^Like/ }) as HTMLButtonElement
}

test('signed-out users see the count and a sign-in link instead of the button', async () => {
  setup({ store: null })
  expect(await screen.findByText('3 likes')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/')
  expect(screen.queryByRole('button')).toBeNull()
})

test('the button waits while the session is being restored, then enables once signed in', async () => {
  const store = fakeStore()
  const { rerender } = setup({ store: null, authPending: true })
  expect(await screen.findByText('3 likes')).toBeTruthy()
  expect(likeButton().disabled).toBe(true)
  expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()

  rerender({ store, authPending: false })
  await waitFor(() => expect(likeButton().disabled).toBe(false))
  expect(store.hasLiked).toHaveBeenCalledWith('W123')
})

test('a restoration that ends signed out shows the sign-in link', async () => {
  const { rerender } = setup({ store: null, authPending: true })
  await screen.findByText('3 likes')
  rerender({ authPending: false })
  expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

test('the button stays disabled until the account’s like state is known', async () => {
  const lookup = deferred<boolean>()
  const { store, user } = setup({ store: fakeStore({ hasLiked: vi.fn(() => lookup.promise) }) })
  await screen.findByText('3 likes')
  expect(likeButton().disabled).toBe(true)
  await user.click(likeButton())
  expect(store!.like).not.toHaveBeenCalled()

  await act(async () => lookup.resolve(true))
  await waitFor(() => expect(likeButton().disabled).toBe(false))
  expect(likeButton().getAttribute('aria-pressed')).toBe('true')
})

test('liking a paper marks the button and increases the count', async () => {
  const { store, counter, user } = setup()
  await screen.findByText('3 likes')
  await waitFor(() => expect(likeButton().disabled).toBe(false))
  expect(counter.countLikes).toHaveBeenCalledWith('W123')
  expect(likeButton().getAttribute('aria-pressed')).toBe('false')
  expect(likeButton().textContent).toBe('Like')

  await user.click(likeButton())
  await waitFor(() => expect(likeButton().getAttribute('aria-pressed')).toBe('true'))
  expect(likeButton().textContent).toBe('Liked')
  expect(screen.getByText('4 likes')).toBeTruthy()
  expect(store!.like).toHaveBeenCalledTimes(1)
  expect(store!.like).toHaveBeenCalledWith('W123')
})

test('a paper the account already liked loads as liked and can be unliked', async () => {
  const { store, user } = setup({ store: fakeStore({ hasLiked: vi.fn(async () => true) }) })
  await screen.findByText('3 likes')
  await waitFor(() => expect(likeButton().getAttribute('aria-pressed')).toBe('true'))

  await user.click(likeButton())
  await waitFor(() => expect(likeButton().getAttribute('aria-pressed')).toBe('false'))
  expect(screen.getByText('2 likes')).toBeTruthy()
  expect(store!.unlike).toHaveBeenCalledWith('W123')
})

test('the count updates immediately and the button is disabled while a like is saved', async () => {
  const write = deferred()
  const like = vi.fn(() => write.promise)
  const { user } = setup({ store: fakeStore({ like }) })
  await screen.findByText('3 likes')
  await waitFor(() => expect(likeButton().disabled).toBe(false))

  await user.dblClick(likeButton())
  expect(like).toHaveBeenCalledTimes(1)
  expect(screen.getByText('4 likes')).toBeTruthy()
  expect(likeButton().getAttribute('aria-pressed')).toBe('true')
  expect(likeButton().disabled).toBe(true)

  await act(async () => write.resolve())
  await waitFor(() => expect(likeButton().disabled).toBe(false))
  expect(screen.getByText('4 likes')).toBeTruthy()
})

test('a failed like shows an error and rolls back the button and count', async () => {
  const write = deferred()
  const { user } = setup({ store: fakeStore({ like: vi.fn(() => write.promise) }) })
  await screen.findByText('3 likes')
  await waitFor(() => expect(likeButton().disabled).toBe(false))
  await user.click(likeButton())
  expect(screen.getByText('4 likes')).toBeTruthy()

  await act(async () => write.reject(new Error('offline')))
  expect((await screen.findByRole('alert')).textContent).toBe('Could not like this paper. Try again.')
  expect(likeButton().getAttribute('aria-pressed')).toBe('false')
  expect(likeButton().disabled).toBe(false)
  expect(screen.getByText('3 likes')).toBeTruthy()
})

test('a failed unlike shows an error and keeps the paper liked', async () => {
  const write = deferred()
  const { user } = setup({
    store: fakeStore({ hasLiked: vi.fn(async () => true), unlike: vi.fn(() => write.promise) }),
  })
  await screen.findByText('3 likes')
  await waitFor(() => expect(likeButton().getAttribute('aria-pressed')).toBe('true'))
  await user.click(likeButton())
  expect(screen.getByText('2 likes')).toBeTruthy()
  expect(likeButton().disabled).toBe(true)

  await act(async () => write.reject(new Error('offline')))
  expect((await screen.findByRole('alert')).textContent).toBe('Could not remove your like. Try again.')
  expect(likeButton().getAttribute('aria-pressed')).toBe('true')
  expect(likeButton().disabled).toBe(false)
  expect(screen.getByText('3 likes')).toBeTruthy()
})

test('a session without like permission asks the user to sign in again', async () => {
  const { user } = setup({
    store: fakeStore({ like: vi.fn(async () => { throw new LikePermissionError('scope') }) }),
  })
  await waitFor(() => expect(likeButton().disabled).toBe(false))
  await user.click(likeButton())
  expect((await screen.findByRole('alert')).textContent).toBe('Sign out and sign in again to allow likes.')
})

test('an unavailable count does not block liking', async () => {
  const counter: LikeCounter = { countLikes: vi.fn(async () => { throw new Error('offline') }) }
  const { store, user } = setup({ counter })
  expect(await screen.findByText('Likes unavailable')).toBeTruthy()
  await waitFor(() => expect(likeButton().disabled).toBe(false))
  await user.click(likeButton())
  await waitFor(() => expect(likeButton().getAttribute('aria-pressed')).toBe('true'))
  expect(store!.like).toHaveBeenCalledWith('W123')
  expect(screen.getByText('Likes unavailable')).toBeTruthy()
})

test('a failed like-state lookup shows an error and keeps the button disabled', async () => {
  setup({ store: fakeStore({ hasLiked: vi.fn(async () => { throw new Error('offline') }) }) })
  expect((await screen.findByRole('alert')).textContent).toBe('Could not check whether you liked this paper.')
  expect(likeButton().disabled).toBe(true)
})

test('uses singular wording for one like', async () => {
  setup({ counter: fakeCounter(1) })
  expect(await screen.findByText('1 like')).toBeTruthy()
})

test('counts the account’s own like before the public index catches up', async () => {
  setup({ store: fakeStore({ hasLiked: vi.fn(async () => true) }), counter: fakeCounter(0) })
  await waitFor(() => expect(likeButton().getAttribute('aria-pressed')).toBe('true'))
  expect(await screen.findByText('1 like')).toBeTruthy()
})

test('the button and a card count share one count that updates and rolls back together', async () => {
  const write = deferred()
  const counter = fakeCounter(3)
  const { user } = setup({ counter, withCount: true, store: fakeStore({ like: vi.fn(() => write.promise) }) })
  await waitFor(() => expect(screen.getAllByText('3 likes')).toHaveLength(2))
  expect(counter.countLikes).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(likeButton().disabled).toBe(false))

  await user.click(likeButton())
  expect(screen.getAllByText('4 likes')).toHaveLength(2)
  await act(async () => write.reject(new Error('offline')))
  await waitFor(() => expect(screen.getAllByText('3 likes')).toHaveLength(2))
})

test('switching accounts reloads the like state and ignores the old account’s lookup', async () => {
  const oldLookup = deferred<boolean>()
  const oldStore = fakeStore({ hasLiked: vi.fn(() => oldLookup.promise) })
  const newStore = fakeStore({ hasLiked: vi.fn(async () => false) })
  const { rerender, user } = setup({ store: oldStore })
  await screen.findByText('3 likes')

  rerender({ store: newStore })
  await waitFor(() => expect(likeButton().disabled).toBe(false))
  await act(async () => oldLookup.resolve(true))
  expect(likeButton().getAttribute('aria-pressed')).toBe('false')

  await user.click(likeButton())
  expect(newStore.like).toHaveBeenCalledWith('W123')
  expect(oldStore.like).not.toHaveBeenCalled()
})

test('signing out clears the liked state', async () => {
  const { rerender } = setup({ store: fakeStore({ hasLiked: vi.fn(async () => true) }) })
  await waitFor(() => expect(likeButton().getAttribute('aria-pressed')).toBe('true'))
  rerender({ store: null })
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy()
  expect(screen.getByText('3 likes')).toBeTruthy()
})

test('changing papers shows the new paper’s likes and ignores the old paper’s late results', async () => {
  const oldCount = deferred<number>()
  const counter: LikeCounter = {
    countLikes: vi.fn((id: PaperId) => (id === 'W123' ? oldCount.promise : Promise.resolve(9))),
  }
  const store = fakeStore({ hasLiked: vi.fn(async (id: PaperId) => id === 'W456') })
  const { rerender } = setup({ counter, store })

  rerender({ paperId: 'W456' })
  expect(await screen.findByText('9 likes')).toBeTruthy()
  await waitFor(() => expect(likeButton().getAttribute('aria-pressed')).toBe('true'))
  await act(async () => oldCount.resolve(1))
  expect(screen.getByText('9 likes')).toBeTruthy()
  expect(screen.queryByText('1 like')).toBeNull()
})
