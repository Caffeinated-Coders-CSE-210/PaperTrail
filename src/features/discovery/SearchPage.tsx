import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Paper } from '../../shared/paper'
import { paperPath } from '../../shared/paper'
import { listDefaultPapers, openAlexPaperService } from './openalex'
import { SearchBar } from './SearchBar'
import type { SearchType } from './service'

type SearchStatus = 'loading' | 'success' | 'error'

export function SearchPage() {
  const [status, setStatus] = useState<SearchStatus>('loading')
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const defaultPapers = useRef<Paper[] | null>(null)
  const defaultRequest = useRef<Promise<Paper[]> | null>(null)
  const [showingDefault, setShowingDefault] = useState(true)

  async function loadDefaultPapers() {
    const id = ++requestId.current
    setShowingDefault(true)
    setStatus('loading')
    setError(null)

    try {
      if (!defaultRequest.current) defaultRequest.current = listDefaultPapers()
      const results = await defaultRequest.current
      if (id !== requestId.current) return
      defaultPapers.current = results
      setPapers(results)
      setStatus('success')
    } catch (reason) {
      defaultRequest.current = null
      if (id !== requestId.current) return
      setError(reason instanceof Error ? reason.message : 'Unable to load papers. Please try again.')
      setStatus('error')
    }
  }

  useEffect(() => {
    void loadDefaultPapers()
    return () => { requestId.current += 1 }
  }, [])

  async function search(query: string, searchType: SearchType) {
    const id = ++requestId.current
    setShowingDefault(false)
    setStatus('loading')
    setError(null)
    setPapers([])

    try {
      const results = await openAlexPaperService.searchPapers(query, searchType)
      if (id !== requestId.current) return
      setPapers(results)
      setStatus('success')
    } catch (reason) {
      if (id !== requestId.current) return
      setError(reason instanceof Error ? reason.message : 'Unable to search papers. Please try again.')
      setStatus('error')
    }
  }

  function clear() {
    requestId.current += 1
    setError(null)
    setShowingDefault(true)
    if (defaultPapers.current !== null) {
      setPapers(defaultPapers.current)
      setStatus('success')
    } else {
      void loadDefaultPapers()
    }
  }

  return (
    <>
      <h1>Search results</h1>
      <SearchBar onSearch={(query, searchType) => void search(query, searchType)} onClear={clear} loading={status === 'loading'} />
      {status === 'loading' && <p role="status">{showingDefault ? 'Loading papers...' : 'Searching papers...'}</p>}
      {status === 'error' && <p className="search-error" role="alert">{error}</p>}
      {status === 'success' && (
        papers.length === 0 ? (
          <p role="status">{showingDefault ? 'No papers available right now.' : 'No papers found. Try a different search term.'}</p>
        ) : (
          <section aria-label="Search results">
            <ul className="search-result-list">
              {papers.map((paper) => (
                <li key={paper.id}>
                  <Link to={paperPath(paper.id)}>{paper.title}</Link>
                  <span className="search-result-meta">
                    {paper.authors.length ? paper.authors.join(', ') : 'Authors unavailable'}
                    {paper.year !== null && ` · ${paper.year}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      )}
    </>
  )
}
