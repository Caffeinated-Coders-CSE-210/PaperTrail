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

/** A saved paper with a remove button. Reports a failed removal through `onError`. */
function SavedPaperList({ papers, onError }: { papers: Paper[]; onError: (message: string | null) => void }) {
  const { isPending, removePaper } = useBookmarks()

  async function remove(paper: Paper) {
    onError(null)
    try {
      await removePaper(paper.id)
    } catch (reason) {
      onError(bookmarkErrorMessage(reason, `Could not remove “${paper.title}”. Try again.`))
    }
  }

  return (
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
  )
}

/**
 * Lists bookmarks saved only in this browser. Asks once whether to upload them, because account
 * bookmarks are public; after the user keeps them private, they stay listed with a way to upload later.
 */
function BrowserBookmarks() {
  const { browserPapers, keptLocal, uploading, uploadBrowserBookmarks, keepBrowserBookmarks } = useBookmarks()
  const [error, setError] = useState<string | null>(null)
  if (!browserPapers.length) return null

  const one = browserPapers.length === 1
  const count = one ? '1 bookmark' : `${browserPapers.length} bookmarks`

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
      {keptLocal ? (
        <p>
          {one ? 'This bookmark stays' : 'These bookmarks stay'} private to this browser and {one ? 'isn’t' : 'aren’t'} on
          your account. You can upload {one ? 'it' : 'them'} at any time. Bookmarks on your account are public.
        </p>
      ) : (
        <p>
          You have {count} saved only in this browser. Upload {one ? 'it' : 'them'} to your AT Protocol account to
          see {one ? 'it' : 'them'} on other devices. Bookmarks on your account are public.
        </p>
      )}
      <div className="bookmarks-import-actions">
        <button
          type="button"
          className="bookmarks-toggle"
          disabled={uploading}
          onClick={() => run(uploadBrowserBookmarks, 'Some bookmarks could not be uploaded. Try again.')}
        >
          {uploading ? 'Uploading…' : `Upload ${count}`}
        </button>
        {keptLocal ? null : (
          <button
            type="button"
            className="bookmarks-link-button"
            disabled={uploading}
            onClick={() => run(keepBrowserBookmarks, 'Could not save your choice. Try again.')}
          >
            Keep in this browser only
          </button>
        )}
      </div>
      {error ? <p className="bookmarks-error" role="alert">{error}</p> : null}
      <SavedPaperList papers={browserPapers} onError={setError} />
    </section>
  )
}

export function SavedPage() {
  const { status, loadError, papers, browserPapers, isLocal, reload } = useBookmarks()
  const [error, setError] = useState<string | null>(null)

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
          <BrowserBookmarks />
          {papers.length === 0 ? (
            browserPapers.length === 0
              ? <p>You haven’t bookmarked any papers yet. <Link to="/search">Explore papers →</Link></p>
              : null
          ) : (
            <>
              <p role="status">{papers.length === 1 ? '1 saved paper' : `${papers.length} saved papers`}</p>
              {error ? <p className="bookmarks-error" role="alert">{error}</p> : null}
              <SavedPaperList papers={papers} onError={setError} />
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
