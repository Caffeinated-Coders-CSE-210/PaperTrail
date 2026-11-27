import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { PdfReader } from './PdfReader'

// jsdom cannot render PDF canvases/workers. Only the PDF rendering boundary is
// replaced here; the real engine is exercised by the browser fixture harness.
const engine = vi.hoisted(() => ({
  load: 'success',
  pages: 3,
  getData: vi.fn(),
  failRender: false,
  resize: undefined as ResizeObserverCallback | undefined,
}))
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children, loading, onLoadSuccess, onLoadError }: {
    children: React.ReactNode
    loading: React.ReactNode
    onLoadSuccess: (pdf: unknown) => void
    onLoadError: (error: Error) => void
  }) => {
    useEffect(() => {
      if (engine.load === 'success') onLoadSuccess({ numPages: engine.pages, getData: engine.getData })
      if (engine.load === 'error') onLoadError(new Error('Fetch failed'))
    }, [])
    return <>{engine.load === 'pending' ? loading : children}</>
  },
  Page: ({ pageNumber, width, onRenderError }: {
    pageNumber: number
    width: number
    onRenderError: (error: Error) => void
  }) => {
    useEffect(() => { if (engine.failRender) onRenderError(new Error('Canvas failed')) }, [])
    return <div data-testid="pdf-page" data-width={width}>Rendered page {pageNumber}</div>
  },
}))

beforeEach(() => {
  engine.load = 'success'
  engine.pages = 3
  engine.failRender = false
  engine.getData.mockReset().mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { engine.resize = callback }
    observe() {}
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800 } as DOMRect)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('unavailable PDF sources', () => {
  it('shows a missing-PDF message and a separate paper-page link', () => {
    render(<PdfReader pdfUrl={null} title="Example paper" sourceUrl="https://example.org/paper" />)
    expect(screen.getByText(/no PDF is available/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Visit paper page' }).getAttribute('href')).toBe('https://example.org/paper')
    expect(screen.queryByRole('link', { name: 'Open source PDF' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull()
  })

  it.each(['javascript:alert(1)', 'data:application/pdf,unsafe', 'blob:https://papertrail.test/arbitrary'])('does not create links from unsafe URL scheme %s', (pdfUrl) => {
    render(<PdfReader pdfUrl={pdfUrl} title="Example" sourceUrl="data:text/html,unsafe" />)
    expect(screen.getByRole('alert').textContent).toMatch(/invalid PDF link/i)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('does not load an HTTP PDF inside an HTTPS page', () => {
    render(<PdfReader pdfUrl="http://example.org/paper.pdf" title="Example" />)
    expect(screen.getByRole('alert').textContent).toMatch(/insecure HTTP/i)
    expect(screen.getByRole('link', { name: 'Open source PDF' }).getAttribute('href')).toBe('http://example.org/paper.pdf')
  })
})

describe('PDF reading', () => {
  const props = { pdfUrl: 'https://example.org/paper.pdf', title: 'Example paper' }

  it('shows loading status with disabled controls until the PDF loads', () => {
    engine.load = 'pending'
    render(<PdfReader {...props} />)
    expect(screen.getByText('Loading PDF…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'Open source PDF' })).toBeTruthy()
  })

  it('navigates pages, validates page input, and disables boundary buttons', async () => {
    const user = userEvent.setup()
    render(<PdfReader {...props} />)
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Rendered page 2')).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'Page number' }) as HTMLInputElement
    await user.clear(input)
    await user.type(input, '99{Enter}')
    expect(screen.getByRole('alert').textContent).toMatch(/between 1 and 3/)
    expect(input.value).toBe('2')
    await user.clear(input)
    await user.type(input, '3')
    await user.tab()
    expect(screen.getByText('Rendered page 3')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(screen.getByText('Rendered page 2')).toBeTruthy()
  })

  it('fits the container, clamps zoom, and resets to fit width', async () => {
    const user = userEvent.setup()
    render(<PdfReader {...props} />)
    expect(screen.getByTestId('pdf-page').getAttribute('data-width')).toBe('800')
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('200%')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('pdf-page').getAttribute('data-width')).toBe('1600')
    await user.click(screen.getByRole('button', { name: 'Fit width' }))
    expect(screen.getByTestId('pdf-page').getAttribute('data-width')).toBe('800')
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(screen.getByText('50%')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => engine.resize?.([{ contentRect: { width: 360 } } as ResizeObserverEntry], {} as ResizeObserver))
    expect(screen.getByTestId('pdf-page').getAttribute('data-width')).toBe('180')
  })

  it('resets page and zoom when the source changes', async () => {
    const user = userEvent.setup()
    const view = render(<PdfReader {...props} />)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    view.rerender(<PdfReader {...props} pdfUrl="https://example.org/second.pdf" />)
    expect(screen.getByText('Rendered page 1')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it('shows external fallbacks on load failure and can retry', async () => {
    engine.load = 'error'
    const user = userEvent.setup()
    render(<PdfReader {...props} sourceUrl="https://example.org/paper" />)
    expect(screen.getByRole('alert').textContent).toMatch(/unable to load/i)
    expect(screen.getAllByRole('link')).toHaveLength(2)
    engine.load = 'success'
    await user.click(screen.getByRole('button', { name: 'Retry PDF' }))
    expect(screen.getByText('Rendered page 1')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ends a stalled load with a recoverable timeout', () => {
    vi.useFakeTimers()
    engine.load = 'pending'
    render(<PdfReader {...props} />)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByRole('alert').textContent).toMatch(/timed out/i)
    expect(screen.getByRole('button', { name: 'Retry PDF' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open source PDF' })).toBeTruthy()
  })

  it('does not save a stale download after changing documents', async () => {
    let resolve!: (bytes: Uint8Array) => void
    engine.getData.mockReturnValue(new Promise<Uint8Array>((done) => { resolve = done }))
    const create = vi.fn()
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create })
    const user = userEvent.setup()
    const view = render(<PdfReader {...props} />)
    await user.click(screen.getByRole('button', { name: 'Download PDF' }))
    expect((screen.getByRole('button', { name: 'Downloading…' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<PdfReader {...props} pdfUrl={null} />)
    await act(async () => resolve(new Uint8Array([37, 80, 68, 70])))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByText(/no PDF is available/i)).toBeTruthy()
  })

  it('handles page rendering failures as recoverable errors', () => {
    engine.failRender = true
    render(<PdfReader {...props} />)
    expect(screen.getByRole('alert').textContent).toMatch(/unable to render/i)
    expect(screen.getByRole('button', { name: 'Retry PDF' })).toBeTruthy()
  })

  it('downloads the loaded PDF bytes through a blob URL', async () => {
    const create = vi.fn((_blob: Blob) => 'blob:download')
    const revoke = vi.fn()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create
      static revokeObjectURL = revoke
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<PdfReader {...props} />)
    await user.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(engine.getData).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob)
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe('blob:download')
    expect(anchor.download).toBe('Example paper.pdf')
    cleanup()
    expect(revoke).toHaveBeenCalledWith('blob:download')
  })

  it('keeps external access when downloading bytes fails', async () => {
    engine.getData.mockRejectedValue(new Error('Network lost'))
    const user = userEvent.setup()
    render(<PdfReader {...props} />)
    await user.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/download failed/i))
    expect(screen.getByRole('link', { name: 'Open source PDF' })).toBeTruthy()
    expect(screen.getByText('Rendered page 1')).toBeTruthy()
  })
})


describe('verified Blob inputs', () => {
  it('reads a Blob without accepting a blob URL, preserves the session on rerender and resets for another Blob', async () => {
    const blob = new Blob(['%PDF-1.4'])
    const view = render(<PdfReader pdfBlob={blob} title="Uploaded" />)
    expect(screen.getByText('Rendered page 1')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open source PDF' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    view.rerender(<PdfReader pdfBlob={blob} title="Uploaded" />)
    expect(screen.getByText('Rendered page 2')).toBeTruthy()
    expect(screen.getByText('125%')).toBeTruthy()
    view.rerender(<PdfReader pdfBlob={new Blob(['%PDF-other'])} title="Uploaded" />)
    expect(screen.getByText('Rendered page 1')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it('recovers a Blob download failure through Retry PDF and downloads successfully afterwards', async () => {
    engine.getData.mockRejectedValueOnce(new Error('Bytes unavailable'))
    const create = vi.fn(() => 'blob:download')
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create
      static revokeObjectURL = vi.fn()
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<PdfReader pdfBlob={new Blob(['%PDF-'])} title="Uploaded" />)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.click(screen.getByRole('button', { name: 'Download PDF' }))
    expect(screen.getByRole('alert').textContent).toMatch(/download failed/i)
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Retry PDF' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Page number' }) as HTMLInputElement).value).toBe('1')
    await user.click(screen.getByRole('button', { name: 'Download PDF' }))
    expect(click).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
  })

  it('delegates a Blob download recovery to the publication retrieval owner', async () => {
    engine.getData.mockRejectedValue(new Error('Bytes unavailable'))
    const onRetry = vi.fn()
    render(<PdfReader pdfBlob={new Blob(['%PDF-'])} title="Uploaded" onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry PDF' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('retries a failed Blob render', async () => {
    engine.load = 'error'
    render(<PdfReader pdfBlob={new Blob(['%PDF-'])} title="Uploaded" />)
    expect(screen.getByRole('alert').textContent).toMatch(/unable to load/i)
    expect(screen.getByRole('alert').textContent).not.toMatch(/open the source PDF/i)
    engine.load = 'success'
    await userEvent.click(screen.getByRole('button', { name: 'Retry PDF' }))
    expect(screen.getByText('Rendered page 1')).toBeTruthy()
  })
})
