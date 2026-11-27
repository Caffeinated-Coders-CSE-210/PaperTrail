import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { PublishPage } from './PublishPage'
import { PublicationDetailsPage } from './PublicationDetailsPage'
import { MyPublicationsPage } from './MyPublicationsPage'
import type { PublicationService } from './service'
import type { Publication } from './model'
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const publication: Publication = {
  ref: { source: 'publication', repoDid: did, rkey: 'key-1' }, uri: `at://${did}/app.papertrail.paper/key-1`, cid: 'record-cid', createdAt: '2026-11-23T00:00:00.000Z',
  metadata: { title: 'Published paper', authors: ['Ada'], year: null, abstract: 'Useful abstract', doi: null, url: null, publicationDate: null, researchArea: 'Computer Science', keywords: ['Testing'] },
  pdf: { kind: 'pds-blob', repoDid: did, blob: { $type: 'blob', ref: { $link: 'cid' }, mimeType: 'application/pdf', size: 20 } },
}
function service(overrides: Partial<PublicationService> = {}): PublicationService {
  return { prepare: vi.fn(), getPublication: async () => publication, getPublicationPdf: async () => new Blob(['%PDF-']), listMyPublications: async () => ({ publications: [] }), ...overrides }
}
// jsdom lacks Blob.arrayBuffer; use its real FileReader rather than replacing uploaded Files.
const arrayBufferDescriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer')
vi.mock('../reader/PdfReader', () => ({ PdfReader: ({ title }: { title: string }) => <section aria-label={`PDF reader: ${title}`} /> }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ identity: null, pending: null }) }))

beforeEach(() => {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: function () {
    return new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(this) })
  } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); if (arrayBufferDescriptor) Object.defineProperty(Blob.prototype, 'arrayBuffer', arrayBufferDescriptor); else Reflect.deleteProperty(Blob.prototype, 'arrayBuffer') })
function router(node: React.ReactNode) { return render(<MemoryRouter>{node}</MemoryRouter>) }
test('signed-out visitors see sign-in guidance instead of an enabled publish form', () => {
  router(<PublishPage service={null} />)
  expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/')
  expect(screen.queryByRole('button', { name: 'Review publication' })).toBeNull()
})
test('reviews metadata, confirms public visibility and retries the same prepared attempt', async () => {
  const publish = vi.fn().mockRejectedValueOnce(new Error('PDS unavailable')).mockResolvedValue(publication)
  const prepare = vi.fn(() => ({ ref: publication.ref, publish }))
  router(<PublishPage service={service({ prepare })} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Title'), 'Published paper')
  await user.type(screen.getByLabelText('Authors (one per line)'), 'Ada')
  const file = new File(['%PDF-1.4\n'], 'paper.pdf', { type: 'application/pdf' })
  await user.upload(screen.getByLabelText('PDF file (up to 5 MiB)'), file)
  // jsdom's required file validity does not recognize user-event's FileList. Browser submission is covered by Playwright.
  fireEvent.submit(screen.getByRole('button', { name: 'Review publication' }).closest('form')!)
  expect(await screen.findByText(/metadata and PDF will be public/)).toBeTruthy()
  expect(publish).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Publish publicly' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('PDS unavailable'))
  await user.click(screen.getByRole('button', { name: 'Retry publication' }))
  expect(await screen.findByRole('link', { name: 'View publication' })).toBeTruthy()
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(publish).toHaveBeenCalledTimes(2)
})
test('publication details load by route and retain metadata when the PDF is unavailable', async () => {
  const getPublication = vi.fn(async () => publication)
  render(<MemoryRouter initialEntries={[`/publications/${encodeURIComponent(did)}/key-1`]}><Routes><Route path="publications/:repoDid/:rkey" element={<PublicationDetailsPage service={service({ getPublication, getPublicationPdf: async () => { throw new Error('PDF unavailable') } })} />} /></Routes></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 1, name: 'Published paper' })).toBeTruthy()
  expect(getPublication).toHaveBeenCalledWith(publication.ref, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('PDF unavailable'))
  expect(screen.getByText('Useful abstract')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
})
test('missing publications and lookup failures have distinct recoverable states', async () => {
  router(<PublicationDetailsPage refOverride={publication.ref} service={service({ getPublication: async () => null })} />)
  expect(await screen.findByText('Publication not found.')).toBeTruthy()
  cleanup()
  const getPublication = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(publication)
  router(<PublicationDetailsPage refOverride={publication.ref} service={service({ getPublication })} />)
  await screen.findByRole('alert')
  await userEvent.click(screen.getByRole('button', { name: 'Retry metadata' }))
  expect(await screen.findByRole('heading', { name: 'Published paper' })).toBeTruthy()
})
test('My publications preserves the first page on a failed next-page request and retries its cursor', async () => {
  const listMyPublications = vi.fn().mockResolvedValueOnce({ publications: [publication], cursor: 'next-page' }).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ publications: [] })
  router(<MyPublicationsPage service={service({ listMyPublications })} />)
  await screen.findByRole('link', { name: 'Published paper' })
  await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('link', { name: 'Published paper' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading publications' }))
  await waitFor(() => expect(listMyPublications).toHaveBeenCalledTimes(3))
  expect(listMyPublications.mock.calls[2][0]).toBe('next-page')
})

test('review includes optional metadata before public confirmation', async () => {
  router(<PublishPage service={service({ prepare: () => ({ ref: publication.ref, publish: async () => publication }) })} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Title'), 'Paper')
  await user.type(screen.getByLabelText('Authors (one per line)'), 'Ada')
  await user.type(screen.getByLabelText('Abstract'), 'Review this abstract')
  await user.type(screen.getByLabelText('Research area'), 'Computer Science')
  await user.type(screen.getByLabelText('Keywords (comma separated)'), 'Agents, Testing')
  await user.upload(screen.getByLabelText('PDF file (up to 5 MiB)'), new File(['%PDF-1.4'], 'paper.pdf', { type: 'application/pdf' }))
  // jsdom's required file validity does not recognize user-event's FileList. Browser submission is covered by Playwright.
  fireEvent.submit(screen.getByRole('button', { name: 'Review publication' }).closest('form')!)
  await screen.findByRole('button', { name: 'Publish publicly' })
  expect(screen.getByText('Review this abstract')).toBeTruthy()
  expect(screen.getByText('Computer Science')).toBeTruthy()
  expect(screen.getByText('Agents, Testing')).toBeTruthy()
})


test('automatically reads the PDF, retries only the PDF and keeps metadata and community navigation', async () => {
  let metadataCalls = 0
  let pdfCalls = 0
  const api = service({
    getPublication: async () => { metadataCalls++; return publication },
    getPublicationPdf: async () => { if (++pdfCalls === 1) throw new Error('PDF unavailable'); return new Blob(['%PDF-']) },
  })
  router(<PublicationDetailsPage refOverride={publication.ref} service={api} />)
  await screen.findByRole('alert')
  expect(screen.getByText('Computer Science')).toBeTruthy()
  expect(screen.getByText('Testing')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Retry PDF' }))
  expect(await screen.findByRole('region', { name: 'PDF reader: Published paper' })).toBeTruthy()
  expect(metadataCalls).toBe(1)
  expect(screen.getByRole('link', { name: 'Back to community papers' }).getAttribute('href')).toBe('/community')
  expect(screen.getByRole('link', { name: 'My publications' }).getAttribute('href')).toBe('/publications')
})

test('aborts old PDF requests on route changes and ignores late results, including after unmount', async () => {
  let oldSignal!: AbortSignal
  let finish!: (blob: Blob) => void
  const other = { ...publication, ref: { ...publication.ref, rkey: 'key-2' }, uri: publication.uri + '2', metadata: { ...publication.metadata, title: 'Second paper' } }
  const api = service({
    getPublication: async ref => ref.rkey === 'key-1' ? publication : other,
    getPublicationPdf: async (ref, options) => {
      if (ref.rkey === 'key-1') { oldSignal = options!.signal!; return new Promise<Blob>(resolve => { finish = resolve }) }
      return new Blob(['%PDF-second'])
    },
  })
  const view = router(<PublicationDetailsPage refOverride={publication.ref} service={api} />)
  await waitFor(() => expect(oldSignal).toBeDefined())
  view.rerender(<MemoryRouter><PublicationDetailsPage refOverride={other.ref} service={api} /></MemoryRouter>)
  expect(await screen.findByRole('region', { name: 'PDF reader: Second paper' })).toBeTruthy()
  expect(oldSignal.aborted).toBe(true)
  finish(new Blob(['%PDF-old']))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'PDF reader: Published paper' })).toBeNull())
  view.unmount()
})

test('cancels a stalled PDF on timeout, retries and ignores its late failure', async () => {
  let signal!: AbortSignal
  let rejectOld!: (reason: Error) => void
  let calls = 0
  const api = service({ getPublicationPdf: async (_ref, options) => {
    if (++calls === 1) {
      signal = options!.signal!
      return new Promise<Blob>((_resolve, reject) => { rejectOld = reject })
    }
    return new Blob(['%PDF-'])
  } })
  vi.useFakeTimers()
  try {
    router(<PublicationDetailsPage refOverride={publication.ref} service={api} />)
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('timed out')
    expect(screen.getByText('Useful abstract')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry PDF' }))
    await act(async () => {})
    expect(screen.getByRole('region', { name: 'PDF reader: Published paper' })).toBeTruthy()
    await act(async () => rejectOld(new Error('Old request failed')))
    expect(screen.queryByRole('alert')).toBeNull()
  } finally { vi.useRealTimers() }
})

test('a late metadata response cannot replace the current publication and unmount cancels PDF loading', async () => {
  let resolveOld!: (value: Publication) => void
  let oldSignal!: AbortSignal
  let pdfSignal!: AbortSignal
  const other = { ...publication, ref: { ...publication.ref, rkey: 'key-2' }, metadata: { ...publication.metadata, title: 'Second paper' } }
  const api = service({
    getPublication: async (ref, options) => {
      if (ref.rkey === 'key-1') {
        oldSignal = options!.signal!
        return new Promise<Publication>(resolve => { resolveOld = resolve })
      }
      return other
    },
    getPublicationPdf: async (_ref, options) => { pdfSignal = options!.signal!; return new Promise<Blob>(() => {}) },
  })
  const view = router(<PublicationDetailsPage refOverride={publication.ref} service={api} />)
  view.rerender(<MemoryRouter><PublicationDetailsPage refOverride={other.ref} service={api} /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Second paper' })
  await act(async () => resolveOld(publication))
  expect(oldSignal.aborted).toBe(true)
  expect(screen.queryByRole('heading', { name: 'Published paper' })).toBeNull()
  view.unmount()
  expect(pdfSignal.aborted).toBe(true)
})
