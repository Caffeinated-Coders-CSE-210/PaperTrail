import type { PaperId } from '../../shared/paper'

/** Public like totals across all accounts. Rejects when the count is unavailable. */
export interface LikeCounter {
  countLikes(id: PaperId): Promise<number>
}

/** The signed-in account's likes. Every method rejects on failure. */
export interface LikeStore {
  hasLiked(id: PaperId): Promise<boolean>
  /** Liking an already-liked paper keeps a single like. */
  like(id: PaperId): Promise<void>
  unlike(id: PaperId): Promise<void>
}
