import type { Paper, PaperId } from '../../shared/paper'

export type SearchType = 'paper' | 'author'

export const PAPER_PAGE_SIZE = 20

export interface PaperService {
  listDefaultPapers(page?: number, fieldId?: string): Promise<Paper[]>
  searchPapers(query: string, searchType?: SearchType, page?: number, fieldId?: string): Promise<Paper[]>
  getPaperById(id: PaperId): Promise<Paper | null>
}
