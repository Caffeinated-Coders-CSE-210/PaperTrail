import type { Paper, PaperId } from '../../shared/paper'

export type SearchType = 'paper' | 'author'

export interface PaperService {
  searchPapers(query: string, searchType?: SearchType): Promise<Paper[]>
  getPaperById(id: PaperId): Promise<Paper | null>
}
