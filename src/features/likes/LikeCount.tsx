import type { PaperId } from '../../shared/paper'
import { formatLikes, usePaperLikes } from './LikesContext'
import './likes.css'

/** Read-only like total for paper cards. Renders nothing while loading or unavailable. */
export function LikeCount({ paperId }: { paperId: PaperId }) {
  const likes = usePaperLikes(paperId)
  if (typeof likes?.count !== 'number') return null
  return <span className="likes-count">{formatLikes(likes.count)}</span>
}
