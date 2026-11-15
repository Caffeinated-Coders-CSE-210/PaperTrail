import type { Paper, PaperId } from '../../shared/paper'

/** Each instance operates on the current user's library. */
export interface BookmarkStorage {
  listSavedPapers(): Promise<Paper[]>
  savePaper(paper: Paper): Promise<void>
  removeSavedPaper(id: PaperId): Promise<void>
}
