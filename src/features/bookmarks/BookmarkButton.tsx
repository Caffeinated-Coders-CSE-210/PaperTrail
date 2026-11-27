import { useState } from 'react'
import { Link } from 'react-router'
import type { Paper } from '../../shared/paper'
import { useBookmarks } from './BookmarksContext'
import { bookmarkErrorMessage } from './errors'
import './bookmarks.css'

/** Discovery mounts this on the details page with the loaded paper. */
export function BookmarkButton({ paper }: { paper: Paper }) {
  const { status, loadError, isLocal, isSaved, isPending, savePaper, removePaper, reload } = useBookmarks()
  const [error, setError] = useState<string | null>(null)

  if (status === 'signed-out') {
    return (
      <p className="bookmarks-action bookmarks-hint">
        <Link to="/">Sign in</Link> to bookmark this paper.
      </p>
    )
  }

  if (status === 'error') {
    return (
      <p className="bookmarks-action bookmarks-error" role="alert">
        {bookmarkErrorMessage(loadError, 'Your bookmarks could not be loaded.')}{' '}
        <button type="button" className="bookmarks-link-button" onClick={reload}>Retry</button>
      </p>
    )
  }

  const saved = isSaved(paper.id)
  const pending = isPending(paper.id)

  async function toggle() {
    setError(null)
    try {
      if (saved) await removePaper(paper.id)
      else await savePaper(paper)
    } catch (reason) {
      setError(bookmarkErrorMessage(
        reason,
        saved ? 'Could not remove this bookmark. Try again.' : 'Could not bookmark this paper. Try again.',
      ))
    }
  }

  let label = saved ? 'Bookmarked' : 'Bookmark'
  if (pending) label = saved ? 'Removing…' : 'Saving…'

  return (
    <div className="bookmarks-action">
      <button
        type="button"
        className="bookmarks-toggle"
        aria-pressed={saved}
        disabled={status === 'loading' || pending}
        onClick={toggle}
      >
        {label}
      </button>
      {saved && !pending ? <Link to="/saved">View saved papers</Link> : null}
      {error ? <p className="bookmarks-error" role="alert">{error}</p> : null}
      <p className="bookmarks-note">
        {isLocal ? 'Bookmarks are saved in this browser only.' : 'Bookmarks are public on your AT Protocol account.'}
      </p>
    </div>
  )
}
