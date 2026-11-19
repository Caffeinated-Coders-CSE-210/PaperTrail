import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SearchPage } from './SearchPage'
import { makePaper } from './testFixtures'
import type { PaperService } from './service'
import type { Paper } from '../../shared/paper'

afterEach(cleanup)
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Tests must use the fake paper service'))
})

const loadedPapers = Array.from({ length: 20 }, (_, i) => makePaper({ id: `W${i + 1}`, title: `Paper ${i + 1}` }))
const searchResults = loadedPapers.map((paper) => ({ ...paper, title: `Search ${paper.title}` }))

function setup(overrides: Partial<PaperService> = {}) {
  const service = {
    listDefaultPapers: vi.fn(async () => loadedPapers),
    searchPapers: vi.fn(async () => searchResults),
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
  expect(screen.getAllByRole('article')).toHaveLength(4)
  expect(screen.getByText('Page 1 of 5')).toBeTruthy()
  expect(screen.getByText('Showing up to 20 papers. Refine your search for different results.')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Browse papers' })).toBeTruthy()
})

test('pages through the loaded papers without making more requests', async () => {
  const { service, user } = setup()
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('link', { name: 'Paper 5' })
  expect(screen.getAllByRole('article')).toHaveLength(4)
  expect(screen.queryByRole('link', { name: 'Paper 1' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Previous' }))
  await screen.findByRole('link', { name: 'Paper 1' })
  for (const firstTitle of ['Paper 5', 'Paper 9', 'Paper 13', 'Paper 17']) {
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('link', { name: firstTitle })
  }
  expect(screen.getByText('Page 5 of 5')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Paper 20' })).toBeTruthy()
  expect(screen.getAllByRole('article')).toHaveLength(4)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true)
  expect(service.listDefaultPapers).toHaveBeenCalledTimes(1)
  expect(service.searchPapers).not.toHaveBeenCalled()
})

test.each(['paper', 'author'] as const)('resets a new %s search to page 1 and pages locally', async (mode) => {
  const { service, user } = setup()
  await screen.findByRole('link', { name: 'Paper 1' })
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('link', { name: 'Paper 5' })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Search mode' }), mode)
  await user.type(screen.getByRole('searchbox'), 'vision')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('link', { name: 'Search Paper 1' })
  expect(service.searchPapers).toHaveBeenCalledWith('vision', mode, 1)
  expect(screen.getByText('Page 1 of 5')).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled).toBe(true)
  // Editing the input without submitting must not change the loaded results.
  await user.type(screen.getByRole('searchbox'), ' draft')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('link', { name: 'Search Paper 5' })
  expect(service.searchPapers).toHaveBeenCalledTimes(1)
  expect(service.listDefaultPapers).toHaveBeenCalledTimes(1)
})

test('Clear returns from search page 2 to default page 1', async () => {
  const { service, user } = setup()
  await screen.findByRole('link', { name: 'Paper 1' })
  await user.selectOptions(screen.getByRole('combobox'), 'author')
  await user.type(screen.getByRole('searchbox'), 'Alice')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('link', { name: 'Search Paper 1' })
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('link', { name: 'Search Paper 5' })
  expect(service.searchPapers).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Clear' }))
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(service.listDefaultPapers).toHaveBeenLastCalledWith(1)
  expect(screen.getByText('Page 1 of 5')).toBeTruthy()
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

test('disables pagination during a new search and recovers from failure with Clear', async () => {
  let reject!: (error: Error) => void
  const pending = new Promise<Paper[]>((_resolve, rejectRequest) => { reject = rejectRequest })
  const { user } = setup({
    searchPapers: vi.fn(() => pending),
  })
  await screen.findByRole('link', { name: 'Paper 1' })
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('link', { name: 'Paper 5' })
  expect(screen.queryByRole('status')).toBeNull()
  await user.type(screen.getByRole('searchbox'), 'vision')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.getByRole('status').textContent).toBe('Searching papers...')
  for (const name of ['Previous', 'Next']) {
    expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true)
  }
  reject(new Error('OpenAlex unavailable'))
  expect((await screen.findByRole('alert')).textContent).toBe('OpenAlex unavailable')
  expect(screen.queryByRole('status')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Clear' }))
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(screen.getByText('Page 1 of 5')).toBeTruthy()
})

test('shows the remaining three papers on a partial final page', async () => {
  const { service, user } = setup({ listDefaultPapers: vi.fn(async () => loadedPapers.slice(0, 7)) })
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(screen.getAllByRole('article')).toHaveLength(4)
  expect(screen.getByText('Page 1 of 2')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('link', { name: 'Paper 5' })
  expect(screen.getByRole('link', { name: 'Paper 7' })).toBeTruthy()
  expect(screen.getAllByRole('article')).toHaveLength(3)
  expect(screen.getByText('Page 2 of 2')).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Previous' }))
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(service.listDefaultPapers).toHaveBeenCalledTimes(1)
})

test('does not duplicate the initial request in React StrictMode', async () => {
  const service: PaperService = {
    listDefaultPapers: vi.fn(async () => loadedPapers),
    searchPapers: vi.fn(async () => []),
    getPaperById: vi.fn(async () => null),
  }
  render(<StrictMode><MemoryRouter><SearchPage service={service} /></MemoryRouter></StrictMode>)
  await screen.findByRole('link', { name: 'Paper 1' })
  expect(service.listDefaultPapers).toHaveBeenCalledTimes(1)
})
