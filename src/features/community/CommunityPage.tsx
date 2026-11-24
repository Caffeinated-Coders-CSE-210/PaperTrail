import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { publicationPath, type Publication } from '../publishing/model'
import { readCatalog, type CatalogRequest } from './discovery'
import '../publishing/publishing.css'

const firstPage: CatalogRequest = { kind: 'publishers' }

export function CommunityPage() {
  const [papers, setPapers] = useState<Publication[]>([])
  const [more, setMore] = useState<CatalogRequest[]>([])
  const [failed, setFailed] = useState<CatalogRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [area, setArea] = useState('')
  const active = useRef<AbortController | null>(null)

  async function load(task: CatalogRequest) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setLoading(true)
    try {
      const page = await readCatalog(task, controller.signal)
      if (controller.signal.aborted) return
      setPapers(previous => [...new Map([...previous, ...page.papers].map(paper => [paper.uri, paper])).values()])
      setMore(previous => [...previous.filter(item => item !== task), ...page.more])
      setFailed(previous => [...previous.filter(item => item !== task), ...page.failed])
    } catch {
      if (controller.signal.aborted) return
      setMore(previous => previous.filter(item => item !== task))
      setFailed(previous => [...previous.filter(item => item !== task), task])
    } finally {
      if (active.current === controller) {
        active.current = null
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void load(firstPage)
    return () => { active.current?.abort(); active.current = null }
  }, [])
  const areas = [...new Set(papers.flatMap(paper => paper.metadata.researchArea ? [paper.metadata.researchArea] : []))].sort()
  const term = query.trim().toLowerCase()
  const visible = papers.filter(({ metadata }) =>
    (!area || metadata.researchArea === area) &&
    [metadata.title, ...metadata.authors, ...metadata.keywords].some(text => text.toLowerCase().includes(term)))
  return <section className="publishing">
    <h1>Community papers</h1>
    <p><Link to="/search">Browse OpenAlex papers</Link></p>
    <label>Search loaded publications <input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <label>Research area <select value={area} onChange={e => setArea(e.target.value)}>
      <option value="">All research areas</option>
      {areas.map(name => <option key={name}>{name}</option>)}
    </select></label>
    {loading && <p role="status">Loading community papers…</p>}
    {failed.length > 0 && <p role="alert">Some public records could not be loaded. <button disabled={loading} onClick={() => void load(failed[0])}>Retry failed request</button></p>}
    {!loading && !visible.length && (papers.length > 0 || !failed.length) &&
      <p>{papers.length ? 'No loaded publications match these filters.' : 'No publications found on this page.'}</p>}
    <ul className="publishing__list">{visible.map(paper => <li key={paper.uri}>
      <Link to={publicationPath(paper.ref)}>{paper.metadata.title}</Link>
      <p>{paper.metadata.authors.join(', ')}</p>
      <p className="publishing__identifier">Published by {paper.ref.repoDid}</p>
    </li>)}</ul>
    {more.length > 0 && <button disabled={loading} onClick={() => void load(more[0])}>Load more community papers</button>}
  </section>
}
