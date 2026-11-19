import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SearchPage } from './SearchPage'
import { makePaper } from './testFixtures'
import type { PaperService, SearchType } from './service'
import type { Paper } from '../../shared/paper'

afterEach(cleanup)
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Tests must use the fake paper service'))
})

const firstPage = Array.from({ length: 20 }, (_, i) => makePaper({ id: `W${i + 1}`, title: `Paper ${i + 1}` }))
const secondPage = [makePaper({ id: 'W21', title: 'Next batch paper' })]

function setup(overrides: Partial<PaperService> = {}) {
  const service = {
    listDefaultPapers: vi.fn(async (page = 1) => page === 1 ? firstPage : secondPage),
    searchPapers: vi.fn(async () => firstPage),
    getPaperById: vi.fn(async () => null),
    ...overrides,
  }
  render(<MemoryRouter><SearchPage service={service} /></MemoryRouter>)
  return { service, user: userEvent.setup() }
}

test('opens with default papers linked to their details', async () => {
  const { service } = setup()
  expect((await screen.findByRole('link', { name: 'Paper 1' })).getAttribute('href')).toBe('/papers/W1')
  expect(service.listDefaultPapers).toHaveBeenCalledWith(1)
  expect(screen.getAllByRole('article')).toHaveLength(20)
  expect(screen.getByRole('heading', { name: 'Browse papers' })).toBeTruthy()
})

test('moves between batches and disables Next after a short batch', async () => {
  const { service, user } = setup()
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('link', { name: 'Next batch paper' })
  expect(service.listDefaultPapers).toHaveBeenLastCalledWith(2)
  expect(screen.queryByRole('link', { name: 'Paper 1' })).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Previous' }))
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(service.listDefaultPapers).toHaveBeenLastCalledWith(1)
})

test.each(['paper', 'author'] as const)('resets a new %s search to page 1 and preserves it on Next', async (mode) => {
  const searchPapers = vi.fn(async (_query: string, _mode?: SearchType, page = 1) =>
    page === 1 ? firstPage : secondPage)
  const { user } = setup({ searchPapers })
  await screen.findByRole('link', { name: 'Paper 1' })
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('link', { name: 'Next batch paper' })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Search mode' }), mode)
  await user.type(screen.getByRole('searchbox'), 'vision')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(searchPapers).toHaveBeenLastCalledWith('vision', mode, 1)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled).toBe(true)
  // Editing the input without submitting must not change the active search.
  await user.type(screen.getByRole('searchbox'), ' draft')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('link', { name: 'Next batch paper' })
  expect(searchPapers).toHaveBeenLastCalledWith('vision', mode, 2)
})

test('Clear returns from search page 2 to default page 1', async () => {
  const searchPapers = vi.fn(async () => firstPage)
  const { service, user } = setup({ searchPapers })
  await screen.findByRole('link', { name: 'Paper 1' })
  await user.selectOptions(screen.getByRole('combobox'), 'author')
  await user.type(screen.getByRole('searchbox'), 'Alice')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(searchPapers).toHaveBeenLastCalledWith('Alice', 'author', 2)
  await user.click(screen.getByRole('button', { name: 'Clear' }))
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(service.listDefaultPapers).toHaveBeenLastCalledWith(1)
  expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('')
  expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('paper')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled).toBe(true)
})

test('shows an empty state for default browsing and search', async () => {
  const { user } = setup({
    listDefaultPapers: vi.fn(async () => []),
    searchPapers: vi.fn(async () => []),
  })
  await screen.findByText('No papers available right now.')
  expect(screen.queryAllByRole('article')).toHaveLength(0)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true)
  await user.type(screen.getByRole('searchbox'), 'unmatched')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByText('No papers found. Try a different search term.')
  expect(screen.queryAllByRole('article')).toHaveLength(0)
})

test('disables pagination while loading and shows request failures', async () => {
  let reject!: (error: Error) => void
  const pending = new Promise<Paper[]>((_resolve, rejectRequest) => { reject = rejectRequest })
  const { user } = setup({
    listDefaultPapers: vi.fn(async (page = 1) => page === 1 ? firstPage : pending),
  })
  await screen.findByRole('link', { name: 'Paper 1' })
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('status').textContent).toBe('Loading papers...')
  for (const name of ['Previous', 'Next']) {
    expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true)
  }
  reject(new Error('OpenAlex unavailable'))
  expect((await screen.findByRole('alert')).textContent).toBe('OpenAlex unavailable')
  expect(screen.queryByRole('status')).toBeNull()
  // A failed later page must still allow returning to the previous page.
  await user.click(screen.getByRole('button', { name: 'Previous' }))
  await screen.findByRole('link', { name: 'Paper 1' })
})

test('does not duplicate the initial request in React StrictMode', async () => {
  const service: PaperService = {
    listDefaultPapers: vi.fn(async () => firstPage),
    searchPapers: vi.fn(async () => []),
    getPaperById: vi.fn(async () => null),
  }
  render(<StrictMode><MemoryRouter><SearchPage service={service} /></MemoryRouter></StrictMode>)
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(service.listDefaultPapers).toHaveBeenCalledTimes(1)
})
