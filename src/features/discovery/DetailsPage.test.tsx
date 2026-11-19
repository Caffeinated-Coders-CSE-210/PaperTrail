import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { DetailsPage } from './DetailsPage'
import { makePaper } from './testFixtures'
import type { PaperService } from './service'

// Reader behavior is covered by DetailsPage.reader.test.tsx and reader tests.
vi.mock('../reader/PdfReader', () => ({ PdfReader: () => null }))

afterEach(cleanup)

function setup(getPaperById: PaperService['getPaperById']) {
  const service: PaperService = {
    listDefaultPapers: vi.fn(async () => []),
    searchPapers: vi.fn(async () => []),
    getPaperById,
  }
  render(
    <MemoryRouter initialEntries={['/papers/W123']}>
      <Routes><Route path="papers/:paperId" element={<DetailsPage service={service} />} /></Routes>
    </MemoryRouter>,
  )
}

test('loads metadata from a direct details URL and links back to Browse', async () => {
  const paper = makePaper()
  const getPaperById = vi.fn(async () => paper)
  setup(getPaperById)
  await screen.findByRole('heading', { level: 1, name: paper.title })
  expect(getPaperById).toHaveBeenCalledWith('W123')
  for (const text of ['Alice Chen, Bob Lee', '2024-05-10', 'Computer Science', 'Discovery', paper.abstract!]) {
    expect(screen.getByText(text)).toBeTruthy()
  }
  expect(screen.getByRole('link', { name: 'Back to Browse' }).getAttribute('href')).toBe('/search')
  expect(screen.getByText('Full-text link unavailable')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Read full text' })).toBeNull()
})

test.each([
  { source: 'PDF when available', pdfUrl: 'https://example.org/paper.pdf', expected: 'https://example.org/paper.pdf' },
  { source: 'landing page when no PDF is available', pdfUrl: null, expected: 'https://example.org/paper' },
])('links to the $source', async ({ pdfUrl, expected }) => {
  const paper = makePaper({ pdfUrl, url: 'https://example.org/paper' })
  setup(vi.fn(async () => paper))
  const link = await screen.findByRole('link', { name: 'Read full text' })
  expect(link.getAttribute('href')).toBe(expected)
  expect(screen.queryByText('Full-text link unavailable')).toBeNull()
})

test('shows a missing paper message and retains the Browse link', async () => {
  setup(vi.fn(async () => null))
  await screen.findByText('Paper not found.')
  expect(screen.getByRole('link', { name: 'Back to Browse' }).getAttribute('href')).toBe('/search')
})

test('shows a lookup error and retains the Browse link', async () => {
  setup(vi.fn(async () => { throw new Error('Service unavailable') }))
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to load this paper. Please try again.')
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('link', { name: 'Back to Browse' }).getAttribute('href')).toBe('/search')
})
