import type { Paper, PaperId } from '../../shared/paper'

/** PDS collection for bookmarks. Each record key is the paper ID, so an account holds at most one bookmark per paper. */
export const BOOKMARK_COLLECTION = 'app.papertrail.bookmark'

/** Paper fields copied into the record so the saved list renders without refetching OpenAlex. */
export interface BookmarkedPaper {
  title: string
  authors: string[]
  year?: number
  doi?: string
  url?: string
  publicationDate?: string
  researchArea?: string
  keywords?: string[]
  pdfUrl?: string
}

export interface BookmarkRecord {
  $type: typeof BOOKMARK_COLLECTION
  /** OpenAlex work URL, matching the likes subject format. */
  subject: string
  paper: BookmarkedPaper
  createdAt: string
}

export interface ParsedBookmark {
  paper: Paper
  createdAt: string
}

export function bookmarkSubject(id: PaperId) {
  return `https://openalex.org/${id}`
}

export function isPaperId(value: string): value is PaperId {
  return /^W\d+$/.test(value)
}

/** Records cannot hold `null`, so missing metadata is omitted. */
export function bookmarkRecord(paper: Paper, now = new Date()): BookmarkRecord {
  const snapshot: BookmarkedPaper = { title: paper.title, authors: paper.authors }
  if (paper.year !== null) snapshot.year = paper.year
  if (paper.doi !== null) snapshot.doi = paper.doi
  if (paper.url !== null) snapshot.url = paper.url
  if (paper.publicationDate !== null) snapshot.publicationDate = paper.publicationDate
  if (paper.researchArea !== null) snapshot.researchArea = paper.researchArea
  if (paper.keywords.length) snapshot.keywords = paper.keywords
  if (paper.pdfUrl !== null) snapshot.pdfUrl = paper.pdfUrl
  return { $type: BOOKMARK_COLLECTION, subject: bookmarkSubject(paper.id), paper: snapshot, createdAt: now.toISOString() }
}

const optionalString = (value: unknown) => (typeof value === 'string' ? value : null)
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : null)

/** Returns `null` for records this version cannot display, so one bad record doesn't hide the rest. */
export function parseBookmark(rkey: string, value: unknown): ParsedBookmark | null {
  if (!isPaperId(rkey) || !value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.$type !== BOOKMARK_COLLECTION || typeof record.createdAt !== 'string') return null
  if (!record.paper || typeof record.paper !== 'object') return null
  const paper = record.paper as Record<string, unknown>
  const authors = strings(paper.authors)
  if (typeof paper.title !== 'string' || !authors) return null

  return {
    createdAt: record.createdAt,
    paper: {
      id: rkey,
      title: paper.title,
      authors,
      year: Number.isInteger(paper.year) ? (paper.year as number) : null,
      abstract: null,
      doi: optionalString(paper.doi),
      url: optionalString(paper.url),
      publicationDate: optionalString(paper.publicationDate),
      researchArea: optionalString(paper.researchArea),
      keywords: strings(paper.keywords) ?? [],
      pdfUrl: optionalString(paper.pdfUrl),
    },
  }
}
