import { isValidDid, isValidNsid, isValidRecordKey } from '@atproto/syntax'
import { parseCid } from '@atproto/lex-data'
import type { FetchHandler } from '../auth/session.ts'

export type ErrorCode = 'authentication' | 'permission' | 'forbidden' | 'too-large' | 'rate-limit' | 'conflict' | 'network' | 'api' | 'invalid-response' | 'invalid-record' | 'document-unavailable'
export class PdsError extends Error {
  readonly code: ErrorCode
  readonly status?: number
  readonly protocolCode?: string
  constructor(code: ErrorCode, message: string, status?: number, protocolCode?: string) {
    super(message)
    this.name = 'PdsError'
    this.code = code
    this.status = status
    this.protocolCode = protocolCode
  }
}
export interface RecordIdentity { uri: string; cid: string }
export interface RepositoryRecord extends RecordIdentity { value: unknown }
export interface RecordPage { records: RepositoryRecord[]; cursor?: string }
export type RequestOptions = { signal?: AbortSignal }
export type ListOptions = RequestOptions & { cursor?: string; limit?: number }

export function recordObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PdsError('invalid-response', 'The server returned invalid data.')
  return value as Record<string, unknown>
}
export async function request(fetchHandler: FetchHandler, path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const deadline = AbortSignal.timeout(30000)
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline
    signal.throwIfAborted()
    const response = await fetchHandler(path, { ...init, signal })
    if (response.ok) return response
    const body = await readBoundedJson(response, 16 * 1024).catch(error => {
      if (error instanceof PdsError) throw error
      return null
    })
    const protocolCode = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : undefined
    const code: ErrorCode = response.status === 401 ? 'authentication'
      : protocolCode === 'InsufficientScope' ? 'permission'
        : response.status === 403 ? 'forbidden'
          : response.status === 413 ? 'too-large'
            : response.status === 429 ? 'rate-limit'
              : protocolCode === 'InvalidSwap' || protocolCode === 'RecordAlreadyExists' ? 'conflict' : 'api'
    throw new PdsError(code, `PDS request failed (${response.status}${protocolCode ? `, ${protocolCode}` : ''}).`, response.status, protocolCode)
  } catch (error) {
    if (error instanceof PdsError || init.signal?.aborted) throw error
    throw new PdsError('network', 'Could not reach the PDS. Retry the request.')
  }
}
/** Limit decoded bytes before parsing; Content-Length can describe an encoded body. */
async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body) throw new SyntaxError('Missing JSON body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new PdsError('invalid-response', 'The PDS JSON response exceeds its size limit.', response.status)
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
export async function readJson(response: Response, limit = 1024 * 1024): Promise<Record<string, unknown>> {
  try { return recordObject(await readBoundedJson(response, limit)) }
  catch (error) {
    if (error instanceof PdsError) throw error
    throw new PdsError('invalid-response', 'The server returned invalid JSON.', response.status)
  }
}
function checkKey(collection: string, rkey?: string) {
  if (!isValidNsid(collection) || (rkey !== undefined && !isValidRecordKey(rkey))) throw new Error('Invalid collection or record key.')
}
function identity(data: unknown, repo: string, collection: string, rkey?: string): RecordIdentity {
  const row = recordObject(data)
  if (typeof row.uri !== 'string' || typeof row.cid !== 'string') throw new PdsError('invalid-response', 'Missing record identity.')
  const prefix = `at://${repo}/${collection}/`
  const key = row.uri.startsWith(prefix) ? row.uri.slice(prefix.length) : ''
  if (!isValidRecordKey(key) || (rkey !== undefined && key !== rkey)) throw new PdsError('invalid-response', 'The PDS returned a different record.')
  try { parseCid(row.cid) } catch { throw new PdsError('invalid-response', 'Invalid record CID.') }
  return { uri: row.uri, cid: row.cid }
}
export function createRepositoryClient(repo: string, fetchHandler: FetchHandler) {
  if (!isValidDid(repo)) throw new Error('A repository DID is required.')
  async function write(method: string, collection: string, rkey: string, record?: Record<string, unknown>, swapRecord?: string | null, options: RequestOptions = {}) {
    checkKey(collection, rkey)
    if (record && record.$type !== collection) throw new Error('Record type must match its collection.')
    if (swapRecord) parseCid(swapRecord)
    const body = { repo, collection, rkey, ...(record ? { record } : {}), ...(swapRecord !== undefined ? { swapRecord } : {}) }
    return request(fetchHandler, `/xrpc/com.atproto.repo.${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: options.signal })
  }
  return {
    async createRecord(collection: string, rkey: string, record: Record<string, unknown>, options: RequestOptions = {}) {
      return identity(await readJson(await write('createRecord', collection, rkey, record, undefined, options)), repo, collection, rkey)
    },
    async putRecord(collection: string, rkey: string, record: Record<string, unknown>, swapRecord?: string | null, options: RequestOptions = {}) {
      return identity(await readJson(await write('putRecord', collection, rkey, record, swapRecord, options)), repo, collection, rkey)
    },
    async deleteRecord(collection: string, rkey: string, swapRecord?: string, options: RequestOptions = {}) {
      await write('deleteRecord', collection, rkey, undefined, swapRecord, options)
    },
    async getRecord(collection: string, rkey: string, options: RequestOptions = {}): Promise<RepositoryRecord | null> {
      checkKey(collection, rkey)
      const params = new URLSearchParams({ repo, collection, rkey })
      let response: Response
      try { response = await request(fetchHandler, `/xrpc/com.atproto.repo.getRecord?${params}`, options) }
      catch (error) {
        if (error instanceof PdsError && error.status === 400 && error.protocolCode === 'RecordNotFound') return null
        throw error
      }
      const row = await readJson(response)
      if (!row.value || typeof row.value !== 'object') throw new PdsError('invalid-response', 'Missing record value.')
      return { ...identity(row, repo, collection, rkey), value: row.value }
    },
    async listRecords(collection: string, options: ListOptions = {}): Promise<RecordPage> {
      checkKey(collection)
      const limit = options.limit ?? 20
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid page size.')
      const params = new URLSearchParams({ repo, collection, limit: String(limit) })
      if (options.cursor) params.set('cursor', options.cursor)
      const data = await readJson(await request(fetchHandler, `/xrpc/com.atproto.repo.listRecords?${params}`, { signal: options.signal }), 8 * 1024 * 1024)
      if (!Array.isArray(data.records) || (data.cursor !== undefined && typeof data.cursor !== 'string')) throw new PdsError('invalid-response', 'Invalid record page.')
      const records = data.records.map(value => {
        const row = recordObject(value)
        if (!row.value || typeof row.value !== 'object') throw new PdsError('invalid-response', 'Missing record value.')
        return { ...identity(row, repo, collection), value: row.value }
      })
      return { records, ...(data.cursor ? { cursor: data.cursor as string } : {}) }
    },
  }
}
export type RepositoryClient = ReturnType<typeof createRepositoryClient>

export async function resolvePds(did: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  if (!isValidDid(did)) throw new Error('Invalid DID.')
  let url: string
  if (/^did:plc:[a-z2-7]{24}$/.test(did)) url = `https://plc.directory/${did}`
  else if (/^did:web:[a-zA-Z0-9.-]+$/.test(did)) url = `https://${did.slice(8)}/.well-known/did.json`
  else throw new Error('Only AT Protocol did:plc and domain-only did:web identities are supported.')
  const data = await readJson(await request((path, init) => fetchFn(path, { ...init, credentials: 'omit', redirect: 'error' }), url, { signal }))
  if (data.id !== did || !Array.isArray(data.service)) throw new PdsError('invalid-response', 'Invalid DID document.')
  const service = data.service.find(s => s && (s.id === '#atproto_pds' || s.id === `${did}#atproto_pds`) && s.type === 'AtprotoPersonalDataServer')
  if (!service || typeof service.serviceEndpoint !== 'string') throw new PdsError('invalid-response', 'No PDS is available for this identity.')
  const endpoint = new URL(service.serviceEndpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new PdsError('invalid-response', 'Unsupported PDS endpoint.')
  return endpoint.origin
}
export async function createPublicRepositoryClient(did: string, options: RequestOptions = {}, fetchFn: typeof fetch = fetch) {
  const endpoint = await resolvePds(did, fetchFn, options.signal)
  return createRepositoryClient(did, (path, init) => fetchFn(new URL(path, endpoint), { ...init, credentials: 'omit', redirect: 'error' }))
}
