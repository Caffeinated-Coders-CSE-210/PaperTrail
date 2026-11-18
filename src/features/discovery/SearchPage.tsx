import { useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Paper } from '../../shared/paper'
import { paperPath } from '../../shared/paper'
import { openAlexPaperService } from './openalex'
import { SearchBar } from './SearchBar'
import type { SearchType } from './service'

type SearchStatus = 'idle' | 'loading' | 'success' | 'error'

export function SearchPage() {
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [papers, setPapers] = useState<Paper[]>([])
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  async function search(query: string, searchType: SearchType) {
    const id = ++requestId.current
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
    setStatus('idle')
    setPapers([])
    setError(null)
  }

  return (
    <>
      <h1>Search results</h1>
      <SearchBar onSearch={(query, searchType) => void search(query, searchType)} onClear={clear} loading={status === 'loading'} />
      {status === 'idle' && (
        <>
          <p>OpenAlex search results will appear here.</p>
          <Link to={paperPath('W2741809807')}>Preview paper details →</Link>
        </>
      )}
      {status === 'loading' && <p role="status">Searching papers...</p>}
      {status === 'error' && <p className="search-error" role="alert">{error}</p>}
      {status === 'success' && (
        papers.length === 0 ? (
          <p role="status">No papers found. Try a different search term.</p>
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
