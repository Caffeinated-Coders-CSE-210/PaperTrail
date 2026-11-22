import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import './reader.css'

// Keep the worker bundled locally and on the exact version used by React-PDF.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url,
).toString()

export interface PdfReaderProps {
  pdfUrl: string | null
  title: string
  sourceUrl?: string | null
}

function webUrl(value: string | null | undefined) {
  if (!value?.trim()) return null
  try {
    const url = new URL(value, window.location.href)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

export function PdfReader({ pdfUrl, title, sourceUrl }: PdfReaderProps) {
  const [attempt, setAttempt] = useState(0)
  const pdf = webUrl(pdfUrl)
  const source = webUrl(sourceUrl)
  const insecure = pdf?.startsWith('http:') && window.location.protocol === 'https:'

  return (
    <section className="pdf-reader" aria-label={`PDF reader: ${title}`}>
      {!pdfUrl?.trim() ? <p role="status">No PDF is available for this paper.</p>
        : !pdf ? <p role="alert">Invalid PDF link. Visit the paper page if available.</p>
          : insecure ? <p role="alert">This PDF uses insecure HTTP and cannot be loaded inside this secure page. You can open the source separately.</p>
            : <PdfSession key={JSON.stringify([pdf, title, attempt])} pdfUrl={pdf} title={title} onRetry={() => setAttempt((value) => value + 1)} />}
      <div className="pdf-reader__links">
        {pdf && <a href={pdf} target="_blank" rel="noopener noreferrer">Open source PDF</a>}
        {source && <a href={source} target="_blank" rel="noopener noreferrer">Visit paper page</a>}
      </div>
    </section>
  )
}
function PdfSession({ pdfUrl, title, onRetry }: { pdfUrl: string; title: string; onRetry: () => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [pageError, setPageError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const active = useRef(true)
  const downloadUrls = useRef(new Map<string, number>())
  const inputId = useId()
  const numPages = pdf?.numPages ?? 0
  const ready = Boolean(pdf) && !error

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (pdf || error) return
    const timer = window.setTimeout(() => setError('Loading this PDF timed out. Retry or open the source PDF to read it.'), 30_000)
    return () => window.clearTimeout(timer)
  }, [pdf, error])

  useEffect(() => {
    active.current = true
    const urls = downloadUrls.current
    return () => {
      active.current = false
      urls.forEach((timer, url) => { window.clearTimeout(timer); URL.revokeObjectURL(url) })
      urls.clear()
    }
  }, [])

  function goToPage(next: number) {
    setPage(next)
    setPageInput(String(next))
    setPageError(null)
    viewport.current?.scrollTo?.(0, 0)
  }

  function submitPage() {
    const next = Number(pageInput)
    if (!/^\d+$/.test(pageInput.trim()) || !Number.isInteger(next) || next < 1 || next > numPages) {
      setPageError(`Enter a whole page number between 1 and ${numPages}.`)
      setPageInput(String(page))
      return
    }
    goToPage(next)
  }

  async function download() {
    if (!pdf || downloading) return
    setDownloading(true)
    setDownloadError(null)
    try {
      // Reuse PDF.js's loaded bytes instead of a second cross-origin fetch or
      // relying on a cross-origin anchor's ignored download attribute.
      const bytes = await pdf.getData()
      if (!active.current) return
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      // eslint-disable-next-line no-control-regex -- Strip control characters from download filenames.
      anchor.download = `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120).trim() || 'paper'}.pdf`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      // Allow the browser time to start saving before releasing the URL.
      const timer = window.setTimeout(() => {
        URL.revokeObjectURL(url)
        downloadUrls.current.delete(url)
      }, 30_000)
      downloadUrls.current.set(url, timer)
    } catch {
      if (active.current) setDownloadError('Download failed. Open the source PDF to save it from the source website.')
    } finally {
      if (active.current) setDownloading(false)
    }
  }

  return (
    <>
      <div className="pdf-reader__toolbar" role="group" aria-label="PDF controls">
        <div className="pdf-reader__control-group">
          <button type="button" disabled={!ready || page <= 1} onClick={() => goToPage(page - 1)}>Previous page</button>
          <label htmlFor={inputId}>Page</label>
          <input id={inputId} aria-label="Page number" type="text" inputMode="numeric" value={pageInput}
            disabled={!ready} aria-invalid={Boolean(pageError)} aria-describedby={pageError ? `${inputId}-error` : undefined}
            onChange={(event) => setPageInput(event.target.value)} onBlur={submitPage}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitPage() } }} />
          <span aria-live="polite">/ {numPages || '—'}</span>
          <button type="button" disabled={!ready || page >= numPages} onClick={() => goToPage(page + 1)}>Next page</button>
        </div>
        <div className="pdf-reader__control-group">
          <button type="button" aria-label="Zoom out" disabled={!ready || zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
          <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" disabled={!ready || zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))}>+</button>
          <button type="button" disabled={!ready} onClick={() => setZoom(1)}>Fit width</button>
        </div>
        <button type="button" disabled={!ready || downloading} onClick={() => void download()}>{downloading ? 'Downloading…' : 'Download PDF'}</button>
      </div>
      {pageError && <p id={`${inputId}-error`} role="alert">{pageError}</p>}
      {downloadError && <p role="alert">{downloadError}</p>}
      {error && <div className="pdf-reader__error">
        <p role="alert">{error}</p>
        <button type="button" onClick={onRetry}>Retry PDF</button>
      </div>}
      <div className="pdf-reader__viewport" ref={viewport} tabIndex={0} role="region" aria-label="PDF pages">
        {!error && <Document file={pdfUrl} suspense={false}
          loading={<p role="status">Loading PDF…</p>}
          onLoadSuccess={setPdf}
          onLoadError={() => setError('Unable to load this PDF. The source may restrict access or the document may be unavailable. Open the source PDF or visit the paper page.')}
          onSourceError={() => setError('Unable to load this PDF source. Open the source PDF or visit the paper page.')}
          onPassword={() => setError('This PDF requires a password. Open the source PDF to read it.')}
          externalLinkTarget="_blank" externalLinkRel="noopener noreferrer"
          onItemClick={({ pageNumber }) => { if (pageNumber && pageNumber >= 1 && pageNumber <= numPages) goToPage(pageNumber) }}>
          {pdf && width > 0 && <Page pageNumber={page} width={width * zoom}
            loading={<p role="status">Loading page…</p>}
            onLoadError={() => setError('Unable to render this PDF page. Try again or open the source PDF.')}
            onRenderError={() => setError('Unable to render this PDF page. Try again or open the source PDF.')} />}
        </Document>}
      </div>
    </>
  )
}
