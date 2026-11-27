import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { PublicationRef } from '../../shared/paper'
import { PdfReader } from '../reader/PdfReader'
import { SharePaper } from '../sharing/SharePaper'
import { paperLink } from '../sharing/post'
import { publicationPath, validatePublicationRef, type Publication } from './model'
import { publicPublicationService, publicationErrorMessage, type PublicationService } from './service'
import './publishing.css'

export function PublicationDetailsPage({ service = publicPublicationService, refOverride }: { service?: PublicationService; refOverride?: PublicationRef }) {
  const params = useParams<'repoDid' | 'rkey'>()
  const repoDid = refOverride?.repoDid ?? params.repoDid ?? ''
  const rkey = refOverride?.rkey ?? params.rkey ?? ''
  return <PublicationDetails key={JSON.stringify([repoDid, rkey])} repoDid={repoDid} rkey={rkey} service={service} />
}

function PublicationDetails({ repoDid, rkey, service }: { repoDid: string; rkey: string; service: PublicationService }) {
  const [publication, setPublication] = useState<Publication | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null); setPublication(null)
    void (async () => {
      const ref = validatePublicationRef({ source: 'publication', repoDid, rkey })
      return service.getPublication(ref, { signal: controller.signal })
    })().then(value => { if (!controller.signal.aborted) setPublication(value) }, error => { if (!controller.signal.aborted) setError(publicationErrorMessage(error)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [repoDid, rkey, service, retry])
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
      <SharePaper key={publication.uri} title={metadata.title} url={paperLink(metadata.url, metadata.doi,
        window.location.protocol === 'https:' ? new URL(publicationPath(publication.ref), window.location.origin).href : 'https://pdsls.dev/' + publication.uri)} />
      <h2>PDF</h2><p>PDF · {publication.pdf.blob.size.toLocaleString()} bytes</p>
      <PublicationPdf publication={publication} service={service} />
    </>}
    <p><Link to="/publications">My publications</Link> · <Link to="/community">Back to community papers</Link></p>
  </section>
}

function PublicationPdf({ publication, service }: { publication: Publication; service: PublicationService }) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setBlob(null); setError(null)
    const timer = window.setTimeout(() => {
      controller.abort()
      setError('Loading this PDF timed out. Please retry.')
    }, 30_000)
    void service.getPublicationPdf(publication.ref, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setBlob(value)
    }, reason => {
      if (!controller.signal.aborted) setError(publicationErrorMessage(reason))
    }).finally(() => window.clearTimeout(timer))
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [publication, service, attempt])
  const retry = () => setAttempt(value => value + 1)
  return <>
    {error ? <><p role="alert">{error}</p><button onClick={retry}>Retry PDF</button></>
      : blob ? <PdfReader pdfBlob={blob} title={publication.metadata.title} onRetry={retry} />
        : <p role="status">Loading PDF from publisher…</p>}
  </>
}
