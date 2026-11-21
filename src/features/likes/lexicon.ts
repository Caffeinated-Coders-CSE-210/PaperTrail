import type { PaperId } from '../../shared/paper'

/** PDS collection for likes. Each record key is the liked paper's ID, so an account holds at most one like per paper. */
export const LIKE_COLLECTION = 'app.papertrail.like'

export interface LikeRecord {
  $type: typeof LIKE_COLLECTION
  /** OpenAlex work URL. Constellation indexes this link to count likes. */
  subject: string
  createdAt: string
}

export function likeSubject(id: PaperId) {
  return `https://openalex.org/${id}`
}

export function likeRecord(id: PaperId, now = new Date()): LikeRecord {
  return { $type: LIKE_COLLECTION, subject: likeSubject(id), createdAt: now.toISOString() }
}
