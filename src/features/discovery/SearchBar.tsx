import { useState } from 'react'
import type { FormEvent } from 'react'
import type { SearchType } from './service'
import './search.css'

interface SearchBarProps {
  onSearch: (query: string, searchType: SearchType) => void
  onClear: () => void
  loading?: boolean
}

export function SearchBar({ onSearch, onClear, loading = false }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState<SearchType>('paper')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = query.trim()
    if (text && !loading) onSearch(text, searchType)
  }

  function clear() {
    setQuery('')
    setSearchType('paper')
    onClear()
  }

  return (
    <form className="search-bar" role="search" aria-label="Search research papers" onSubmit={submit}>
      <select
        className="search-mode"
        aria-label="Search mode"
        value={searchType}
        onChange={(event) => setSearchType(event.target.value as SearchType)}
        disabled={loading}
      >
        <option value="paper">Paper</option>
        <option value="author">Author</option>
      </select>
      <input
        className="search-input"
        type="search"
        aria-label="Search query"
        placeholder={searchType === 'paper'
          ? 'Search papers by title or keywords...'
          : 'Search by author name...'}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={loading}
      />
      <button className="search-submit" type="submit" disabled={loading || !query.trim()}>
        {loading ? 'Searching...' : 'Search'}
      </button>
      <button className="search-clear" type="button" onClick={clear} disabled={loading}>
        Clear
      </button>
    </form>
  )
}
