import { useState } from 'react'
import { Link } from 'react-router'
import { paperPath, type Paper } from '../../shared/paper'
import { useBookmarks } from './BookmarksContext'
import './bookmarks.css'

function byline(paper: Paper) {
  const authors = paper.authors.length > 3
    ? `${paper.authors.slice(0, 3).join(', ')} et al.`
    : paper.authors.join(', ')
  return [authors || 'Unknown authors', paper.year].filter(Boolean).join(' · ')
}

export function SavedPage() {
  const { status, papers, isLocal, isPending, removePaper, reload } = useBookmarks()
  const [error, setError] = useState<string | null>(null)

  async function remove(paper: Paper) {
    setError(null)
    try {
      await removePaper(paper.id)
    } catch {
      setError(`Could not remove “${paper.title}”. Try again.`)
    }
  }

  return (
    <>
      <h1>Saved papers</h1>

      {status === 'signed-out' ? (
        <p><Link to="/">Sign in</Link> to see the papers you’ve bookmarked.</p>
      ) : status === 'loading' ? (
        <p role="status">Loading your saved papers…</p>
      ) : status === 'error' ? (
        <p className="bookmarks-error" role="alert">
          Your saved papers could not be loaded.{' '}
          <button type="button" className="bookmarks-link-button" onClick={reload}>Retry</button>
        </p>
      ) : papers.length === 0 ? (
        <p>You haven’t bookmarked any papers yet. <Link to="/search">Explore papers →</Link></p>
      ) : (
        <>
          <p role="status">{papers.length === 1 ? '1 saved paper' : `${papers.length} saved papers`}</p>
          {error ? <p className="bookmarks-error" role="alert">{error}</p> : null}
          <ul className="bookmarks-list">
            {papers.map((paper) => (
              <li key={paper.id} className="bookmarks-item">
                <div>
                  <Link className="bookmarks-title" to={paperPath(paper.id)}>{paper.title}</Link>
                  <p className="bookmarks-meta">{byline(paper)}</p>
                </div>
                <button
                  type="button"
                  className="bookmarks-remove"
                  disabled={isPending(paper.id)}
                  onClick={() => remove(paper)}
                  aria-label={`Remove “${paper.title}” from saved papers`}
                >
                  {isPending(paper.id) ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {isLocal && status !== 'signed-out' ? (
        <p className="bookmarks-note">Demo storage: bookmarks are saved in this browser for your account and aren’t synced to other devices.</p>
      ) : null}
    </>
  )
}
