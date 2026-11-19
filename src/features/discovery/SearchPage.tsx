import { useEffect, useRef, useState } from 'react'
import type { Paper } from '../../shared/paper'
import { openAlexPaperService } from './openalex'
import { PaperCard } from './PaperCard'
import { SearchBar } from './SearchBar'
import { PAPER_PAGE_SIZE, type PaperService, type SearchType } from './service'

type SearchStatus = 'loading' | 'success' | 'error'

export function SearchPage({ service = openAlexPaperService }: { service?: PaperService }) {
  const [request, setRequest] = useState({ query: '', searchType: 'paper' as SearchType, page: 1 })
  const lastRequest = useRef<{
    request: typeof request
    service: PaperService
    result: Promise<Paper[]>
  } | null>(null)
  const [status, setStatus] = useState<SearchStatus>('loading')
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)
  const showingDefault = !request.query

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError(null)
    // StrictMode repeats effects on startup; reuse that request instead of fetching twice.
    if (lastRequest.current?.request !== request || lastRequest.current.service !== service) {
      const result = request.query
        ? service.searchPapers(request.query, request.searchType, request.page)
        : service.listDefaultPapers(request.page)
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
        onSearch={(query, searchType) => setRequest({ query, searchType, page: 1 })}
        onClear={() => setRequest({ query: '', searchType: 'paper', page: 1 })}
        loading={status === 'loading'}
      />
      {status === 'loading' && <p role="status">{showingDefault ? 'Loading papers...' : 'Searching papers...'}</p>}
      {status === 'error' && <p className="search-error" role="alert">{error}</p>}
      {status === 'success' && (
        papers.length === 0 ? (
          <p role="status">{showingDefault ? 'No papers available right now.' : 'No papers found. Try a different search term.'}</p>
        ) : (
          <section aria-label="Papers">
            <ul className="search-result-list">
              {papers.map((paper) => <li key={paper.id}><PaperCard paper={paper} /></li>)}
            </ul>
          </section>
        )
      )}
      <nav className="search-pagination" aria-label="Paper pages">
        <button
          type="button"
          disabled={status === 'loading' || request.page === 1}
          onClick={() => setRequest({ ...request, page: request.page - 1 })}
        >Previous</button>
        <span>Page {request.page}</span>
        <button
          type="button"
          disabled={status !== 'success' || papers.length < PAPER_PAGE_SIZE}
          onClick={() => setRequest({ ...request, page: request.page + 1 })}
        >Next</button>
      </nav>
    </>
  )
}
