import { isValidDid, isValidRecordKey, isValidDatetime } from '@atproto/syntax'
import { parseCid } from '@atproto/lex-data'
import type { PaperMetadata, PublicationRef } from '../../shared/paper.ts'

// Candidate namespace; confirm authority before publishing real user content.
export const PAPER_COLLECTION = 'app.papertrail.paper'
export const MAX_PDF_BYTES = 5 * 1024 * 1024
export const FIELD_LIMITS = { title: 1000, author: 300, abstract: 20000, doi: 500, url: 2000, researchArea: 300, keyword: 100 }
export interface PdfBlobRef {
  $type: 'blob'
  ref: { $link: string }
  mimeType: 'application/pdf'
  size: number
}
export type PdfSource = { kind: 'url'; url: string } | { kind: 'pds-blob'; repoDid: string; blob: PdfBlobRef } | null
export interface Publication {
  ref: PublicationRef
  uri: string
  cid: string
  metadata: PaperMetadata
  createdAt: string
  pdf: { kind: 'pds-blob'; repoDid: string; blob: PdfBlobRef }
}
export type MetadataInput = Pick<PaperMetadata, 'title' | 'authors'> & Partial<PaperMetadata>

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid record data.')
  return value as Record<string, unknown>
}
function text(value: unknown, limit: number): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Expected text.')
  const result = value.trim()
  if (new TextEncoder().encode(result).length > limit) throw new Error(`Text exceeds ${limit} bytes.`)
  return result || null
}
function texts(value: unknown, count: number, limit: number): string[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > count) throw new Error(`Expected at most ${count} entries.`)
  return [...new Set(value.map(v => text(v, limit)).filter((v): v is string => v !== null))]
}
export function normalizeMetadata(input: MetadataInput): PaperMetadata {
  const title = text(input.title, FIELD_LIMITS.title)
  const authors = texts(input.authors, 50, FIELD_LIMITS.author)
  if (!title || !authors.length) throw new Error('Title and at least one author are required.')
  const year = input.year ?? null
  if (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)) throw new Error('Enter a valid year.')
  const publicationDate = text(input.publicationDate, 10)
  if (publicationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(publicationDate) || !Number.isFinite(Date.parse(publicationDate)) || new Date(publicationDate).toISOString().slice(0, 10) !== publicationDate)) throw new Error('Enter a valid publication date.')
  if (publicationDate && year !== null && Number(publicationDate.slice(0, 4)) !== year) throw new Error('Publication date and year must agree.')
  const url = text(input.url, FIELD_LIMITS.url)
  if (url) {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use an HTTP or HTTPS paper page URL.')
  }
  const doi = text(input.doi, FIELD_LIMITS.doi)?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase() ?? null
  if (doi && !/^10\.\d{4,9}\/\S+$/.test(doi)) throw new Error('Enter a DOI such as 10.1234/example.')
  return { title, authors, year, abstract: text(input.abstract, FIELD_LIMITS.abstract), doi, url, publicationDate, researchArea: text(input.researchArea, FIELD_LIMITS.researchArea), keywords: texts(input.keywords, 30, FIELD_LIMITS.keyword) }
}
export function validatePublicationRef(ref: PublicationRef) {
  if (ref.source !== 'publication' || !isValidDid(ref.repoDid) || !isValidRecordKey(ref.rkey)) throw new Error('Invalid publication identifier.')
  return ref
}
export function publicationPath(ref: PublicationRef) {
  validatePublicationRef(ref)
  return `/publications/${encodeURIComponent(ref.repoDid)}/${encodeURIComponent(ref.rkey)}`
}
export function publicationUri(ref: PublicationRef) {
  validatePublicationRef(ref)
  return `at://${ref.repoDid}/${PAPER_COLLECTION}/${ref.rkey}`
}
export function validatePdfReference(value: unknown): PdfBlobRef {
  const blob = object(value)
  const link = object(blob.ref).$link
  if (blob.$type !== 'blob' || typeof link !== 'string' || blob.mimeType !== 'application/pdf' || !Number.isInteger(blob.size) || Number(blob.size) <= 0 || Number(blob.size) > MAX_PDF_BYTES) throw new Error('Invalid PDF blob reference.')
  const cid = parseCid(link)
  if (cid.version !== 1 || cid.code !== 85 || cid.multihash.code !== 18 || cid.multihash.digest.length !== 32) throw new Error('Invalid PDF content identifier.')
  return { $type: 'blob', ref: { $link: link }, mimeType: 'application/pdf', size: Number(blob.size) }
}
export function publicationRecord(metadata: PaperMetadata, pdf: PdfBlobRef, createdAt: string) {
  return { $type: PAPER_COLLECTION, ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== null)), pdf, createdAt }
}
export function parsePublication(envelope: { uri: string; cid: string; value: unknown }): Publication {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(envelope.uri)
  if (!match || match[2] !== PAPER_COLLECTION) throw new Error('Invalid publication URI.')
  const ref = validatePublicationRef({ source: 'publication', repoDid: match[1], rkey: match[3] })
  parseCid(envelope.cid)
  const value = object(envelope.value)
  if (value.$type !== PAPER_COLLECTION || typeof value.createdAt !== 'string' || !isValidDatetime(value.createdAt)) throw new Error('Invalid publication record.')
  const metadata = normalizeMetadata(value as unknown as MetadataInput)
  return { ref, uri: envelope.uri, cid: envelope.cid, metadata, createdAt: value.createdAt, pdf: { kind: 'pds-blob', repoDid: ref.repoDid, blob: validatePdfReference(value.pdf) } }
}
