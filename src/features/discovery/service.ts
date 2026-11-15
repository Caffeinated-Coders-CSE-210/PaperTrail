import type { Paper, PaperId } from '../../shared/paper'

export interface PaperService {
  searchPapers(query: string): Promise<Paper[]>
  getPaperById(id: PaperId): Promise<Paper | null>
}
