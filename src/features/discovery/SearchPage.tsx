import { useEffect, useRef, useState } from 'react'
import type { Paper } from '../../shared/paper'
import { openAlexPaperService } from './openalex'
import { researchAreas } from './researchAreas'
import { PaperCard } from './PaperCard'
import { SearchBar } from './SearchBar'
import { PAPER_PAGE_SIZE, type PaperService, type SearchType } from './service'

type SearchStatus = 'loading' | 'success' | 'error'
const CARDS_PER_PAGE = 4

export function SearchPage({ service = openAlexPaperService }: { service?: PaperService }) {
  const [request, setRequest] = useState({ query: '', searchType: 'paper' as SearchType, fieldId: '' })
  const [page, setPage] = useState(1)
  const lastRequest = useRef<{
    request: typeof request
    service: PaperService
    result: Promise<Paper[]>
  } | null>(null)
  const [status, setStatus] = useState<SearchStatus>('loading')
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)
  const showingDefault = !request.query
  const pageCount = Math.max(1, Math.ceil(papers.length / CARDS_PER_PAGE))
  const visiblePapers = papers.slice((page - 1) * CARDS_PER_PAGE, page * CARDS_PER_PAGE)

  useEffect(() => {
    let active = true
    setPage(1)
    setStatus('loading')
    setError(null)
    // StrictMode repeats effects on startup; reuse that request instead of fetching twice.
    if (lastRequest.current?.request !== request || lastRequest.current.service !== service) {
      const result = request.query
        ? service.searchPapers(request.query, request.searchType, 1, request.fieldId || undefined)
        : service.listDefaultPapers(1, request.fieldId || undefined)
      lastRequest.current = { request, service, result }
    }

    void lastRequest.current.result.then(
      (papers) => {
        if (!active) return
        setPapers(papers)
        setStatus('success')
      },
      (reason) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'Unable to load papers. Please try again.')
        setStatus('error')
      },
    )
    return () => { active = false }
  }, [request, service])

  return (
    <>
      <h1>Browse papers</h1>
      <SearchBar
        onSearch={(query, searchType) => setRequest({ ...request, query, searchType })}
        onClear={() => setRequest({ ...request, query: '', searchType: 'paper' })}
        loading={status === 'loading'}
      />
      <div className="search-area">
        <label htmlFor="browse-research-area">Research area</label>
        <select id="browse-research-area" value={request.fieldId} onChange={event => setRequest({ ...request, fieldId: event.target.value })}>
          <option value="">All research areas</option>
          {researchAreas.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      <nav className="search-pagination" aria-label="Paper pages">
        <button
          type="button"
          disabled={status !== 'success' || page === 1}
          onClick={() => setPage(page - 1)}
        >Previous</button>
        <span>Page {page} of {pageCount}</span>
        <button
          type="button"
          disabled={status !== 'success' || page === pageCount}
          onClick={() => setPage(page + 1)}
        >Next</button>
      </nav>
      {status === 'loading' && <p role="status">{showingDefault ? 'Loading papers...' : 'Searching papers...'}</p>}
      {status === 'error' && <p className="search-error" role="alert">{error}</p>}
      {status === 'success' && (
        papers.length === 0 ? (
          <p role="status">{request.fieldId ? 'No papers match this research area. Try another area or clear the filter.' : showingDefault ? 'No papers available right now.' : 'No papers found. Try a different search term.'}</p>
        ) : (
          <section aria-label="Papers">
            <p>Showing up to {PAPER_PAGE_SIZE} papers. Refine your search for different results.</p>
            <ul className="search-result-list">
              {visiblePapers.map((paper) => <li key={paper.id}><PaperCard paper={paper} /></li>)}
            </ul>
          </section>
        )
      )}
    </>
  )
}
