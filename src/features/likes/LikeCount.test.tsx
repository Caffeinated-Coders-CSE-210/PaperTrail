import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { LikeCount } from './LikeCount'
import { LikesProvider } from './LikesContext'
import type { LikeCounter } from './service'

afterEach(cleanup)

function renderCount(counter: LikeCounter) {
  return render(
    <LikesProvider store={null} counter={counter}>
      <LikeCount paperId="W123" />
    </LikesProvider>,
  )
}

test.each([
  { count: 0, text: '0 likes' },
  { count: 1, text: '1 like' },
  { count: 12, text: '12 likes' },
])('shows $text', async ({ count, text }) => {
  const counter = { countLikes: vi.fn(async () => count) }
  renderCount(counter)
  expect(await screen.findByText(text)).toBeTruthy()
  expect(counter.countLikes).toHaveBeenCalledWith('W123')
})

test('renders nothing while loading or when the count is unavailable', async () => {
  let fail!: (error: unknown) => void
  const countLikes = vi.fn(() => new Promise<number>((_, reject) => { fail = reject }))
  const { container } = renderCount({ countLikes })
  expect(container.textContent).toBe('')
  await act(async () => fail(new Error('offline')))
  expect(container.textContent).toBe('')
  expect(countLikes).toHaveBeenCalledTimes(1)
})
