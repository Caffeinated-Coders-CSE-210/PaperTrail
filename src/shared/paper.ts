/** Short OpenAlex work ID, e.g. W2741809807. Used in routes and bookmarks. */
export type PaperId = `W${number}`

export interface PaperMetadata {
  title: string
  authors: string[]
  year: number | null
  abstract: string | null
  doi: string | null
  url: string | null
  publicationDate: string | null
  researchArea: string | null
  keywords: string[]
}

export interface Paper extends PaperMetadata {
  id: PaperId
  pdfUrl: string | null
}

export type PublicationRef = { source: 'publication'; repoDid: string; rkey: string }
export type PaperRef = { source: 'openalex'; id: PaperId } | PublicationRef

export function paperPath(id: PaperId) {
  return `/papers/${id}`
}
