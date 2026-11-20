import { useState } from 'react'
import { Link } from 'react-router'
import type { PaperId } from '../../shared/paper'
import { formatLikes, usePaperLikes } from './LikesContext'
import { LikePermissionError } from './pdsLikes'
import type { LikeStore } from './service'
import './likes.css'

/** Discovery mounts this on the details page with the loaded paper's ID. */
export function LikeButton({ paperId }: { paperId: PaperId }) {
  const likes = usePaperLikes(paperId)
  const [error, setError] = useState<{ paperId: PaperId; account: LikeStore | null; message: string } | null>(null)
  if (!likes) return null

  const { account, count, liked, pending, toggle, retry } = likes
  const countText = count === 'error'
    ? 'Likes unavailable'
    : count === 'loading' ? 'Loading likes…' : formatLikes(count)

  async function onClick() {
    const wasLiked = liked === true
    setError(null)
    try {
      await toggle()
    } catch (error) {
      let message = wasLiked ? 'Could not remove your like. Try again.' : 'Could not like this paper. Try again.'
      if (error instanceof LikePermissionError) message = 'Sign out and sign in again to allow likes.'
      setError({ paperId, account, message })
    }
  }

  const writeError = error?.paperId === paperId && error.account === account ? error.message : null

  return (
    <div className="likes-action">
      {liked === 'signed-out' ? null : (
        <button
          type="button"
          className="likes-toggle"
          aria-pressed={liked === true}
          disabled={typeof liked !== 'boolean' || pending}
          onClick={onClick}
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
      ) : writeError ? <p className="likes-error" role="alert">{writeError}</p> : null}
    </div>
  )
}
