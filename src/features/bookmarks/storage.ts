import type { Paper, PaperId } from '../../shared/paper'

/** Each instance operates on the current user's library. */
export interface BookmarkStorage {
  /** Newest first. */
  listSavedPapers(): Promise<Paper[]>
  /** Saving an already-saved paper keeps one entry. */
  savePaper(paper: Paper): Promise<void>
  removeSavedPaper(id: PaperId): Promise<void>
}
