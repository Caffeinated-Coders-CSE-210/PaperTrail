import { useEffect } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DetailsPage } from './DetailsPage'
import { makePaper } from './testFixtures'
import type { PaperService } from './service'

// Keep the real DetailsPage -> PdfReader integration; replace only PDF.js's
// worker/canvas boundary, which jsdom cannot render.
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ file, children, onLoadSuccess, onLoadError }: {
    file: string
    children: React.ReactNode
    onLoadSuccess: (pdf: unknown) => void
    onLoadError: (error: Error) => void
  }) => {
    useEffect(() => {
      if (file.endsWith('/broken.pdf')) onLoadError(new Error('Unavailable PDF'))
      else onLoadSuccess({ numPages: 3, getData: async () => new Uint8Array() })
    }, [])
    return <>{children}</>
  },
  Page: ({ pageNumber }: { pageNumber: number }) => <p>PDF page {pageNumber}</p>,
}))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800 } as DOMRect)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup(getPaperById: PaperService['getPaperById']) {
  const service: PaperService = {
    listDefaultPapers: async () => [], searchPapers: async () => [], getPaperById,
  }
  render(<MemoryRouter initialEntries={['/papers/W123']}>
    <Link to="/papers/W456">Switch paper</Link>
    <Routes>
      <Route path="papers/:paperId" element={<DetailsPage service={service} />} />
      <Route path="search" element={<h1>Browse papers</h1>} />
    </Routes>
  </MemoryRouter>)
}

test('reads a PDF from a direct details URL and navigates back to Browse', async () => {
  const paper = makePaper({ pdfUrl: 'https://example.org/paper.pdf', url: 'https://example.org/paper' })
  const lookup = vi.fn(async () => paper)
  setup(lookup)
  await screen.findByRole('region', { name: `PDF reader: ${paper.title}` })
  expect(lookup).toHaveBeenCalledWith('W123')
  expect(screen.getByRole('link', { name: 'Open source PDF' }).getAttribute('href')).toBe(paper.pdfUrl)
  expect(screen.getByRole('link', { name: 'Visit paper page' }).getAttribute('href')).toBe(paper.url)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  expect(screen.getByText('PDF page 2')).toBeTruthy()
  await user.click(screen.getByRole('link', { name: 'Back to Browse' }))
  expect(screen.getByRole('heading', { name: 'Browse papers' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: /PDF reader/ })).toBeNull()
})

test('keeps metadata and the paper-page link when no PDF is available', async () => {
  const paper = makePaper({ pdfUrl: null, url: 'https://example.org/paper' })
  setup(async () => paper)
  await screen.findByText('No PDF is available for this paper.')
  expect(screen.getByRole('heading', { name: paper.title })).toBeTruthy()
  expect(screen.getByText(paper.abstract!)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Visit paper page' }).getAttribute('href')).toBe(paper.url)
  expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Open source PDF' })).toBeNull()
})

test('preserves metadata and external access when PDF loading fails', async () => {
  const paper = makePaper({ pdfUrl: 'https://example.org/broken.pdf', url: 'https://example.org/paper' })
  setup(async () => paper)
  expect((await screen.findByRole('alert')).textContent).toMatch(/unable to load this PDF/i)
  expect(screen.getByRole('heading', { name: paper.title })).toBeTruthy()
  expect(screen.getByText(paper.abstract!)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Retry PDF' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open source PDF' }).getAttribute('href')).toBe(paper.pdfUrl)
  expect(screen.getByRole('link', { name: 'Visit paper page' }).getAttribute('href')).toBe(paper.url)
})

test('loads the next route paper and resets its page and zoom', async () => {
  setup(async (id) => makePaper({ id, title: `Paper ${id}`, pdfUrl: `https://example.org/${id}.pdf` }))
  await screen.findByRole('region', { name: 'PDF reader: Paper W123' })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await user.click(screen.getByRole('button', { name: 'Zoom in' }))
  await user.click(screen.getByRole('link', { name: 'Switch paper' }))
  await screen.findByRole('region', { name: 'PDF reader: Paper W456' })
  expect(screen.getByText('PDF page 1')).toBeTruthy()
  expect(screen.getByText('100%')).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'PDF reader: Paper W123' })).toBeNull()
})
