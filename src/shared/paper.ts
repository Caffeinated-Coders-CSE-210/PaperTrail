/** Short OpenAlex work ID, e.g. W2741809807. Used in routes and bookmarks. */
export type PaperId = `W${number}`

export interface Paper {
  id: PaperId
  title: string
  authors: string[]
  year: number | null
  abstract: string | null
  doi: string | null
  url: string | null
  publicationDate: string | null
  researchArea: string | null
  keywords: string[]
  pdfUrl: string | null
}

export function paperPath(id: PaperId) {
  return `/papers/${id}`
}
