import type { Paper } from '../../shared/paper'

export function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'W123',
    title: 'Learning to browse research',
    authors: ['Alice Chen', 'Bob Lee'],
    year: 2024,
    publicationDate: '2024-05-10',
    abstract: 'A study of how researchers discover useful papers.',
    researchArea: 'Computer Science',
    keywords: ['Discovery'],
    doi: null,
    url: null,
    pdfUrl: null,
    ...overrides,
  }
}
