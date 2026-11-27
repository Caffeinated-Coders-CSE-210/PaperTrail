import { useState } from 'react'
import { Link } from 'react-router'
import { paperPath, type Paper } from '../../shared/paper'
import { useBookmarks } from './BookmarksContext'
import { bookmarkErrorMessage } from './errors'
import './bookmarks.css'

function byline(paper: Paper) {
  const authors = paper.authors.length > 3
    ? `${paper.authors.slice(0, 3).join(', ')} et al.`
    : paper.authors.join(', ')
  return [authors || 'Unknown authors', paper.year].filter(Boolean).join(' · ')
}

/** Asks before uploading browser-only bookmarks, because account bookmarks are public. */
function ImportPrompt() {
  const { importable, importing, importLocalBookmarks, keepLocalBookmarks } = useBookmarks()
  const [error, setError] = useState<string | null>(null)
  if (!importable.length) return null

  const count = importable.length === 1 ? '1 bookmark' : `${importable.length} bookmarks`

  async function run(action: () => Promise<void>, fallback: string) {
    setError(null)
    try {
      await action()
    } catch (reason) {
      setError(bookmarkErrorMessage(reason, fallback))
    }
  }

  return (
    <section className="bookmarks-import" aria-labelledby="bookmarks-import-heading">
      <h2 id="bookmarks-import-heading">Bookmarks in this browser</h2>
      <p>
        You have {count} saved only in this browser. Upload {importable.length === 1 ? 'it' : 'them'} to
        your AT Protocol account to see {importable.length === 1 ? 'it' : 'them'} on other devices.
        Bookmarks on your account are public.
      </p>
      <div className="bookmarks-import-actions">
        <button
          type="button"
          className="bookmarks-toggle"
          disabled={importing}
          onClick={() => run(importLocalBookmarks, 'Some bookmarks could not be uploaded. Try again.')}
        >
          {importing ? 'Uploading…' : `Upload ${count}`}
        </button>
        <button
          type="button"
          className="bookmarks-link-button"
          disabled={importing}
          onClick={() => run(keepLocalBookmarks, 'Could not save your choice. Try again.')}
        >
          Keep in this browser only
        </button>
      </div>
      {error ? <p className="bookmarks-error" role="alert">{error}</p> : null}
    </section>
  )
}

export function SavedPage() {
  const { status, loadError, papers, isLocal, isPending, removePaper, reload } = useBookmarks()
  const [error, setError] = useState<string | null>(null)

  async function remove(paper: Paper) {
    setError(null)
    try {
      await removePaper(paper.id)
    } catch (reason) {
      setError(bookmarkErrorMessage(reason, `Could not remove “${paper.title}”. Try again.`))
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
          {bookmarkErrorMessage(loadError, 'Your saved papers could not be loaded.')}{' '}
          <button type="button" className="bookmarks-link-button" onClick={reload}>Retry</button>
        </p>
      ) : (
        <>
          <ImportPrompt />
          {papers.length === 0 ? (
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
        </>
      )}

      {status !== 'signed-out' ? (
        <p className="bookmarks-note">
          {isLocal
            ? 'Demo storage: bookmarks are saved in this browser for your account and aren’t synced to other devices.'
            : 'Bookmarks are saved as public records on your AT Protocol account, so they’re available on any device you sign in on.'}
        </p>
      ) : null}
    </>
  )
}
