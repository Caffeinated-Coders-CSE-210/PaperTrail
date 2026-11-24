import type { PublicationRef } from '../../shared/paper.ts'
import type { FetchHandler } from '../auth/session.ts'
import { createRepositoryClient, createPublicRepositoryClient, resolvePds, PdsError, type RequestOptions } from '../repository/client.ts'
import { normalizeMetadata, validatePublicationRef, parsePublication, publicationRecord, PAPER_COLLECTION, type MetadataInput, type PdfBlobRef, type Publication } from './model.ts'
import { uploadPdf, retrievePdf, validatePdfFile } from './pdf.ts'

export type PublicationSession = { did: string; fetchHandler: FetchHandler; isActive(): boolean }
export type PublicationPage = { publications: Publication[]; cursor?: string }
export type PublishStage = 'validating' | 'checking' | 'uploading' | 'publishing'
export interface PublishAttempt {
  ref: PublicationRef
  publish(options?: RequestOptions & { onStage?: (stage: PublishStage) => void }): Promise<Publication>
}
function decodeRecord(row: Parameters<typeof parsePublication>[0]): Publication {
  try { return parsePublication(row) }
  catch { throw new PdsError('invalid-record', 'This publication contains invalid metadata or a PDF reference.') }
}
export function createPublicationService(session: PublicationSession | null, dependencies: { newKey?: () => string; now?: () => string; fetchFn?: typeof fetch } = {}) {
  const fetchFn = dependencies.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  function requireSession() {
    if (!session || !session.isActive()) throw new PdsError('authentication', 'Sign in to publish papers.')
    return session
  }
  return {
    prepare(input: MetadataInput, file: File): PublishAttempt {
      const account = requireSession()
      const metadata = normalizeMetadata(input)
      const ref: PublicationRef = { source: 'publication', repoDid: account.did, rkey: dependencies.newKey?.() ?? crypto.randomUUID() }
      const createdAt = dependencies.now?.() ?? new Date().toISOString()
      const repo = createRepositoryClient(account.did, account.fetchHandler)
      let blob: PdfBlobRef | undefined
      let expected: ReturnType<typeof publicationRecord> | undefined
      let pending: Promise<Publication> | undefined
      let result: Publication | undefined
      function check(signal?: AbortSignal) {
        signal?.throwIfAborted()
        if (!account.isActive()) throw new PdsError('authentication', 'The publishing account changed. Check My publications after signing in again.')
      }
      function match(row: Parameters<typeof parsePublication>[0]) {
        const publication = decodeRecord(row)
        if (!expected || JSON.stringify(publication.metadata) !== JSON.stringify(metadata) || publication.createdAt !== createdAt || JSON.stringify(publication.pdf.blob) !== JSON.stringify(blob)) throw new PdsError('conflict', 'A different publication already uses this identifier. It has not been overwritten.')
        return publication
      }
      async function run(options: RequestOptions & { onStage?: (stage: PublishStage) => void }): Promise<Publication> {
        check(options.signal)
        options.onStage?.('validating')
        await validatePdfFile(file)
        check(options.signal)
        options.onStage?.('checking')
        const existing = await repo.getRecord(PAPER_COLLECTION, ref.rkey, options)
        check(options.signal)
        if (existing) return match(existing)
        if (!blob) {
          options.onStage?.('uploading')
          blob = await uploadPdf(file, account.fetchHandler, options)
          expected = publicationRecord(metadata, blob, createdAt)
        }
        check(options.signal)
        options.onStage?.('publishing')
        try {
          const identity = await repo.createRecord(PAPER_COLLECTION, ref.rkey, expected!, options)
          check(options.signal)
          return decodeRecord({ ...identity, value: expected })
        } catch (error) {
          const invalidBlob = error instanceof PdsError && ['BlobNotFound', 'InvalidBlob'].includes(error.protocolCode ?? '')
          try {
            check(options.signal)
            // A response can be lost after commit. Keep the attempted blob for comparison.
            const recovered = await repo.getRecord(PAPER_COLLECTION, ref.rkey, options)
            check(options.signal)
            if (recovered) return match(recovered)
            throw error
          } finally {
            // Invalidate rejected uploads even if recovery fails or is cancelled.
            if (invalidBlob) { blob = undefined; expected = undefined }
          }
        }
      }
      return {
        ref,
        publish(options = {}) {
          try { check(options.signal) } catch (error) { return Promise.reject(error) }
          if (result) return Promise.resolve(result)
          return pending ??= run(options).then(value => { result = value; return value }).finally(() => { pending = undefined })
        },
      }
    },
    async listMyPublications(cursor?: string, options: RequestOptions = {}): Promise<PublicationPage> {
      const account = requireSession()
      const page = await createRepositoryClient(account.did, account.fetchHandler).listRecords(PAPER_COLLECTION, { cursor, ...options })
      if (!account.isActive()) throw new PdsError('authentication', 'The account changed.')
      return { publications: page.records.map(decodeRecord), ...(page.cursor ? { cursor: page.cursor } : {}) }
    },
    async getPublication(ref: PublicationRef, options: RequestOptions = {}): Promise<Publication | null> {
      validatePublicationRef(ref)
      const repo = await createPublicRepositoryClient(ref.repoDid, options, fetchFn)
      const row = await repo.getRecord(PAPER_COLLECTION, ref.rkey, options)
      return row ? decodeRecord(row) : null
    },
    async getPublicationPdf(ref: PublicationRef, options: RequestOptions = {}): Promise<Blob> {
      validatePublicationRef(ref)
      const endpoint = await resolvePds(ref.repoDid, fetchFn, options.signal)
      const repo = createRepositoryClient(ref.repoDid, (path, init) => fetchFn(new URL(path, endpoint), { ...init, credentials: 'omit', redirect: 'error' }))
      const row = await repo.getRecord(PAPER_COLLECTION, ref.rkey, options)
      if (!row) throw new PdsError('document-unavailable', 'This publication is no longer available.')
      return retrievePdf(endpoint, ref.repoDid, decodeRecord(row).pdf.blob, fetchFn, options)
    },
  }
}
export type PublicationService = ReturnType<typeof createPublicationService>
export const publicPublicationService = createPublicationService(null)
export function publicationErrorMessage(error: unknown): string {
  if (error instanceof PdsError) {
    if (error.code === 'permission') return 'PaperTrail needs permission to publish papers and upload PDFs. Sign out and sign in again to authorize it.'
    if (error.code === 'authentication') return error.message
    if (error.code === 'forbidden') return 'Your PDS refused this operation. Check your account permissions or provider restrictions.'
    if (error.code === 'rate-limit') return 'Your PDS is rate limiting requests. Wait before retrying.'
    if (error.code === 'too-large') return 'Your PDS rejected the file size. Choose a smaller PDF.'
    if (error.protocolCode === 'BlobNotFound' || error.protocolCode === 'InvalidBlob') return 'The temporary PDF upload is unavailable. Retry to upload it again.'
  }
  return error instanceof Error ? error.message : 'The operation failed. Please retry.'
}
