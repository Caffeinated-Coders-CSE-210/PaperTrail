import { Link } from 'react-router'
import type { PaperId } from '../../shared/paper'
import { formatLikes, usePaperLikes, type WriteFailure } from './LikesContext'
import './likes.css'

const failureMessages: Record<WriteFailure, string> = {
  like: 'Could not like this paper. Try again.',
  unlike: 'Could not remove your like. Try again.',
  permission: 'Sign out and sign in again to allow likes.',
}

/** Discovery mounts this on the details page with the loaded paper's ID. */
export function LikeButton({ paperId }: { paperId: PaperId }) {
  const likes = usePaperLikes(paperId)
  if (!likes) return null

  const { count, liked, pending, failure, toggle, retry } = likes
  const countText = count === 'error'
    ? 'Likes unavailable'
    : count === 'loading' ? 'Loading likes…' : formatLikes(count)

  return (
    <div className="likes-action">
      {liked === 'signed-out' ? null : (
        <button
          type="button"
          className="likes-toggle"
          aria-pressed={liked === true}
          disabled={typeof liked !== 'boolean' || pending}
          onClick={toggle}
        >
          {liked === true ? 'Liked' : 'Like'}
        </button>
      )}
      <span className="likes-count">{countText}</span>
      {liked === 'signed-out' ? (
        <span className="likes-hint"><Link to="/">Sign in</Link> to like this paper.</span>
      ) : null}
      {liked === 'error' ? (
        <p className="likes-error" role="alert">
          Could not check whether you liked this paper.{' '}
          <button type="button" className="likes-retry" onClick={retry}>Retry</button>
        </p>
      ) : failure ? <p className="likes-error" role="alert">{failureMessages[failure]}</p> : null}
    </div>
  )
}
