import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { publicationPath, type Publication } from './model'
import { publicationErrorMessage, type PublicationService } from './service'
import './publishing.css'
export function MyPublicationsPage({ service, authPending = false }: { service: PublicationService | null; authPending?: boolean }) {
  const [publications, setPublications] = useState<Publication[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(Boolean(service))
  const [error, setError] = useState<string | null>(null)
  const retryCursor = useRef<string | undefined>(undefined)
  const controller = useRef<AbortController | null>(null)
  async function load(nextCursor?: string) {
    if (!service) return
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    retryCursor.current = nextCursor
    setLoading(true); setError(null)
    try {
      const page = await service.listMyPublications(nextCursor, { signal: abort.signal })
      if (abort.signal.aborted) return
      setPublications(previous => [...new Map([...(nextCursor ? previous : []), ...page.publications].map(item => [item.uri, item])).values()])
      setCursor(page.cursor)
    } catch (error) { if (!abort.signal.aborted) setError(publicationErrorMessage(error)) }
    finally { if (!abort.signal.aborted) setLoading(false) }
  }
  useEffect(() => {
    setPublications([]); setCursor(undefined)
    void load()
    return () => controller.current?.abort()
  }, [service])
  return <section className="publishing"><h1>My publications</h1>
    <p><Link to="/publish">Publish a paper</Link></p>
    {authPending ? <p role="status">Restoring your account…</p> : !service ? <p><Link to="/">Sign in</Link> to see your publications.</p> : <>
      <button onClick={() => void load()} disabled={loading}>Refresh publications</button>
      {loading && <p role="status">Loading publications…</p>}
      {error && <><p role="alert">{error}</p><button onClick={() => void load(retryCursor.current)} disabled={loading}>Retry loading publications</button></>}
      {!loading && !error && !publications.length && <p>You have not published any papers yet.</p>}
      <ul className="publishing__list">{publications.map(publication => <li key={publication.uri}>
        <Link to={publicationPath(publication.ref)}>{publication.metadata.title}</Link>
        <p>{publication.metadata.authors.join(', ')}</p>
      </li>)}</ul>
      {cursor && !error && <button onClick={() => void load(cursor)} disabled={loading}>Load more</button>}
    </>}
  </section>
}
