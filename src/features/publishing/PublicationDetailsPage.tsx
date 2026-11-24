import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { PublicationRef } from '../../shared/paper'
import { validatePublicationRef, type Publication } from './model'
import { publicPublicationService, publicationErrorMessage, type PublicationService } from './service'
import './publishing.css'

export function PublicationDetailsPage({ service = publicPublicationService, refOverride }: { service?: PublicationService; refOverride?: PublicationRef }) {
  const params = useParams<'repoDid' | 'rkey'>()
  const repoDid = refOverride?.repoDid ?? params.repoDid ?? ''
  const rkey = refOverride?.rkey ?? params.rkey ?? ''
  const [publication, setPublication] = useState<Publication | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [pdfStatus, setPdfStatus] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const pdfController = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null); setPublication(null); setPdfStatus(null); setPdfError(null); setChecking(false)
    void (async () => {
      const ref = validatePublicationRef({ source: 'publication', repoDid, rkey })
      return service.getPublication(ref, { signal: controller.signal })
    })().then(value => { if (!controller.signal.aborted) setPublication(value) }, error => { if (!controller.signal.aborted) setError(publicationErrorMessage(error)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); pdfController.current?.abort() }
  }, [repoDid, rkey, service, retry])
  async function checkPdf() {
    if (!publication || checking) return
    const controller = new AbortController(); pdfController.current = controller
    setChecking(true); setPdfError(null); setPdfStatus(null)
    try {
      const blob = await service.getPublicationPdf(publication.ref, { signal: controller.signal })
      if (!controller.signal.aborted) setPdfStatus(`PDF retrieved and verified (${blob.size.toLocaleString()} bytes).`)
    } catch (error) { if (!controller.signal.aborted) setPdfError(publicationErrorMessage(error)) }
    finally { if (!controller.signal.aborted) setChecking(false) }
  }
  const metadata = publication?.metadata
  return <section className="publishing">
    <h1>{metadata?.title ?? 'Publication details'}</h1>
    {loading && <p role="status">Loading publication…</p>}
    {error && <><p role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>Retry metadata</button></>}
    {!loading && !error && !publication && <p>Publication not found.</p>}
    {publication && metadata && <>
      <p>{metadata.authors.join(', ') || 'Authors unavailable'}</p>
      <p>Published by <span className="publishing__identifier">{publication.ref.repoDid}</span></p>
      <p>{metadata.publicationDate ?? metadata.year ?? 'Publication date unavailable'}</p>
      <h2>Abstract</h2><p>{metadata.abstract ?? 'Abstract unavailable'}</p>
      <h2>Research area</h2><p>{metadata.researchArea ?? 'Research area unavailable'}</p>
      <h2>Keywords</h2><p>{metadata.keywords.join(', ') || 'Keywords unavailable'}</p>
      {metadata.doi && <p>DOI: {metadata.doi}</p>}
      {metadata.url && <p><a href={metadata.url} target="_blank" rel="noopener noreferrer">Visit paper page</a></p>}
      <h2>PDF</h2><p>PDF · {publication.pdf.blob.size.toLocaleString()} bytes</p>
      <button onClick={checkPdf} disabled={checking}>{checking ? 'Checking PDF…' : 'Check PDF availability'}</button>
      {pdfStatus && <p role="status">{pdfStatus}</p>}
      {pdfError && <p role="alert">{pdfError}</p>}
      <p>In-app reading for uploaded papers is planned in the next reading update.</p>
    </>}
    <p><Link to="/publications">My publications</Link> · <Link to="/search">Back to Browse</Link></p>
  </section>
}
