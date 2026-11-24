import { cidForRawBytes } from '@atproto/lex-data'
import type { FetchHandler } from '../auth/session.ts'
import { PdsError, request, recordObject, type RequestOptions } from '../repository/client.ts'
import { MAX_PDF_BYTES, validatePdfReference, type PdfBlobRef } from './model.ts'

function pdfHeader(bytes: Uint8Array) {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-'
}
export async function validatePdfFile(file: File, limit = MAX_PDF_BYTES) {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) throw new Error('Choose a PDF file (.pdf).')
  if (file.size <= 0 || file.size > Math.min(limit, MAX_PDF_BYTES)) throw new Error(`PDF must be nonempty and at most ${Math.min(limit, MAX_PDF_BYTES).toLocaleString()} bytes.`)
  if (!pdfHeader(new Uint8Array(await file.slice(0, 5).arrayBuffer()))) throw new Error('This file does not have a PDF header.')
}
export async function uploadPdf(file: File, fetchHandler: FetchHandler, options: RequestOptions = {}): Promise<PdfBlobRef> {
  await validatePdfFile(file)
  const capabilities = recordObject(await (await request(fetchHandler, '/xrpc/com.atproto.server.describeServer', options)).json())
  const limit = capabilities.blobUploadLimit
  if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 0)) throw new PdsError('invalid-response', 'Invalid PDS upload limit.')
  await validatePdfFile(file, typeof limit === 'number' ? limit : MAX_PDF_BYTES)
  options.signal?.throwIfAborted()
  const response = await request(fetchHandler, '/xrpc/com.atproto.repo.uploadBlob', {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file, signal: options.signal,
  })
  const blob = validatePdfReference(recordObject(await response.json()).blob)
  if (blob.size !== file.size || blob.ref.$link !== (await cidForRawBytes(new Uint8Array(await file.arrayBuffer()))).toString()) throw new PdsError('invalid-response', 'Uploaded PDF metadata does not match the selected file.')
  return blob
}
export async function retrievePdf(endpoint: string, did: string, input: PdfBlobRef, fetchFn: typeof fetch = fetch, options: RequestOptions = {}): Promise<Blob> {
  const blob = validatePdfReference(input)
  const url = new URL('/xrpc/com.atproto.sync.getBlob', endpoint)
  url.search = new URLSearchParams({ did, cid: blob.ref.$link }).toString()
  let response: Response
  try { response = await request((path, init) => fetchFn(path, { ...init, credentials: 'omit', redirect: 'error' }), url.href, options) }
  catch (error) {
    if (error instanceof PdsError && error.code === 'api') throw new PdsError('document-unavailable', 'This PDF is unavailable from its PDS.', error.status, error.protocolCode)
    throw error
  }
  if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') throw new PdsError('invalid-response', 'The PDS did not return a PDF.')
  const length = response.headers.get('Content-Length')
  if (length !== null && Number(length) !== blob.size) throw new PdsError('invalid-response', 'The PDF size does not match its record.')
  if (!response.body) throw new PdsError('document-unavailable', 'The PDF has no content.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      options.signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > blob.size || size > MAX_PDF_BYTES) throw new PdsError('too-large', 'The PDF exceeds its declared size.')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  if (size !== blob.size || !pdfHeader(bytes) || (await cidForRawBytes(bytes)).toString() !== blob.ref.$link) throw new PdsError('invalid-response', 'The PDF content does not match its record.')
  return new Blob([bytes], { type: 'application/pdf' })
}
