import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { PaperMetadata } from '../../shared/paper'
import type { FormEvent } from 'react'
import { normalizeMetadata, publicationPath, type Publication } from './model'
import { publicationErrorMessage, type PublicationService, type PublishAttempt, type PublishStage } from './service'
import { validatePdfFile } from './pdf'
import './publishing.css'

const stages: Record<PublishStage, string> = { validating: 'Validating PDF…', checking: 'Checking publication…', uploading: 'Uploading PDF…', publishing: 'Publishing record…' }
export function PublishPage({ service, authPending = false }: { service: PublicationService | null; authPending?: boolean }) {
  const [attempt, setAttempt] = useState<PublishAttempt | null>(null)
  const [preview, setPreview] = useState<(PaperMetadata & { file: File }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Publication | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!service || busy) return
    const data = new FormData(event.currentTarget)
    const string = (key: string) => String(data.get(key) ?? '')
    const file = (event.currentTarget.elements.namedItem('pdf') as HTMLInputElement).files?.[0]
    setBusy(true); setError(null)
    const abort = new AbortController(); controller.current = abort
    try {
      const metadata = normalizeMetadata({ title: string('title'), authors: string('authors').split('\n'), abstract: string('abstract'), researchArea: string('researchArea'), keywords: string('keywords').split(',').filter(Boolean), doi: string('doi'), url: string('url'), publicationDate: string('publicationDate'), year: string('year') ? Number(string('year')) : null })
      if (!file) throw new Error('Choose a PDF file.')
      await validatePdfFile(file)
      if (abort.signal.aborted) return
      setAttempt(service.prepare(metadata, file))
      setPreview({ ...metadata, file })
    } catch (error) { if (!abort.signal.aborted) setError(publicationErrorMessage(error)) }
    finally { if (!abort.signal.aborted) setBusy(false) }
  }
  async function publish() {
    if (!attempt || busy) return
    const abort = new AbortController(); controller.current = abort
    setBusy(true); setStarted(true); setError(null)
    try {
      const publication = await attempt.publish({ signal: abort.signal, onStage: stage => { if (!abort.signal.aborted) setStatus(stages[stage]) } })
      if (!abort.signal.aborted) { setResult(publication); setStatus('Publication saved to your PDS.') }
    } catch (error) {
      if (!abort.signal.aborted) { setError(publicationErrorMessage(error)); setStatus('Publication not confirmed. Retry checks the same identifier first.') }
    } finally { if (!abort.signal.aborted) setBusy(false) }
  }
  return <section className="publishing">
    <h1>Publish a paper</h1>
    {authPending ? <p role="status">Restoring your account…</p> : !service ? <p><Link to="/">Sign in</Link> to publish a paper.</p> : result ? <>
      <p role="status">Publication saved to your PDS.</p>
      <p><Link to={publicationPath(result.ref)}>View publication</Link></p>
      <button onClick={() => { setResult(null); setAttempt(null); setPreview(null); setStarted(false); setStatus('') }}>Publish another paper</button>
    </> : <>
      <p>Publish a PDF and its metadata using your AT Protocol account. PDF limit: 5 MiB; your provider may set a lower limit.</p>
      <form onSubmit={review} hidden={Boolean(preview)}>
        <fieldset disabled={busy}>
          <label>Title<input name="title" required /></label>
          <label>Authors (one per line)<textarea name="authors" required rows={3} /></label>
          <label>Abstract<textarea name="abstract" rows={5} /></label>
          <label>Research area<input name="researchArea" /></label>
          <label>Keywords (comma separated)<input name="keywords" /></label>
          <div className="publishing__columns">
            <label>Year<input name="year" type="number" min="1" max="9999" /></label>
            <label>Publication date<input name="publicationDate" type="date" /></label>
          </div>
          <label>DOI<input name="doi" placeholder="10.1234/example" /></label>
          <label>Paper page URL<input name="url" type="url" /></label>
          <label>PDF file (up to 5 MiB)<input name="pdf" type="file" accept=".pdf,application/pdf" required /></label>
          <button type="submit">{busy ? 'Validating…' : 'Review publication'}</button>
        </fieldset>
      </form>
      {preview && <div className="publishing__review">
        <h2>Review publication</h2><h3>{preview.title}</h3><p>{preview.authors.join(', ')}</p>
        <dl>
          <dt>Abstract</dt><dd>{preview.abstract ?? 'Not provided'}</dd>
          <dt>Research area</dt><dd>{preview.researchArea ?? 'Not provided'}</dd>
          <dt>Keywords</dt><dd>{preview.keywords.join(', ') || 'Not provided'}</dd>
          <dt>Publication date / year</dt><dd>{preview.publicationDate ?? preview.year ?? 'Not provided'}</dd>
          <dt>DOI</dt><dd>{preview.doi ?? 'Not provided'}</dd>
          <dt>Paper page</dt><dd>{preview.url ?? 'Not provided'}</dd>
        </dl>
        <p>{preview.file.name} · {preview.file.size.toLocaleString()} bytes</p>
        <p>Your metadata and PDF will be public and may be copied by others.</p>
        {started && <p>The confirmed information stays fixed during retries. If you leave or refresh, check My publications before starting another attempt.</p>}
        <div className="publishing__actions">
          <button onClick={publish} disabled={busy}>{busy ? status || 'Publishing…' : started ? 'Retry publication' : 'Publish publicly'}</button>
          {!started && <button onClick={() => { setPreview(null); setAttempt(null); setError(null) }} disabled={busy}>Edit information</button>}
        </div>
      </div>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </>}
    <p><Link to="/publications">My publications</Link></p>
  </section>
}
