import { isValidDid, isValidNsid, isValidRecordKey } from '@atproto/syntax'
import type { PaperRef } from '../../shared/paper.ts'
import { likeSubject } from '../likes/lexicon.ts'
import { PAPER_COLLECTION, parsePublication, publicationUri, type Publication } from '../publishing/model.ts'
import { createPublicRepositoryClient, readJson, recordObject, request, type RepositoryRecord } from '../repository/client.ts'

async function publicJson(url: URL, signal?: AbortSignal) {
  const response = await request((path, init) => fetch(path, { ...init, credentials: 'omit', redirect: 'error' }), url.href, { signal })
  return readJson(response)
}

function nextCursor(value: unknown, previous?: string) {
  if (value == null) return undefined
  if (typeof value !== 'string' || !value || value === previous) throw new Error('Invalid discovery cursor.')
  return value
}

export type CatalogRequest = { kind: 'publishers'; cursor?: string } | { kind: 'papers'; did: string; cursor?: string }
export interface CatalogPage {
  papers: Publication[]
  more: CatalogRequest[]
  failed: CatalogRequest[]
}

async function readPublisher(did: string, cursor?: string, signal?: AbortSignal): Promise<CatalogPage> {
  const client = await createPublicRepositoryClient(did, { signal })
  const page = await client.listRecords(PAPER_COLLECTION, { cursor, limit: 20, signal })
  const next = nextCursor(page.cursor, cursor)
  return {
    papers: page.records.map(parsePublication),
    more: next ? [{ kind: 'papers', did, cursor: next }] : [],
    failed: [],
  }
}

export async function readCatalog(task: CatalogRequest, signal?: AbortSignal): Promise<CatalogPage> {
  if (task.kind === 'papers') return readPublisher(task.did, task.cursor, signal)
  const url = new URL('https://relay1.us-east.bsky.network/xrpc/com.atproto.sync.listReposByCollection')
  url.searchParams.set('collection', PAPER_COLLECTION)
  url.searchParams.set('limit', '4')
  if (task.cursor) url.searchParams.set('cursor', task.cursor)
  const data = await publicJson(url, signal)
  if (!Array.isArray(data.repos)) throw new Error('Invalid publisher list.')
  const dids = new Set<string>()
  for (const row of data.repos) {
    const { did } = recordObject(row)
    if (typeof did !== 'string' || !isValidDid(did)) throw new Error('Invalid publisher DID.')
    dids.add(did)
  }
  const next = nextCursor(data.cursor, task.cursor)
  const publishers = [...dids]
  const pages = await Promise.allSettled(publishers.map(did => readPublisher(did, undefined, signal)))
  signal?.throwIfAborted()
  const result: CatalogPage = { papers: [], more: [], failed: [] }
  pages.forEach((page, index) => {
    if (page.status === 'rejected') result.failed.push({ kind: 'papers', did: publishers[index] })
    else {
      result.papers.push(...page.value.papers)
      result.more.push(...page.value.more)
    }
  })
  if (next) result.more.push({ kind: 'publishers', cursor: next })
  return result
}

/** Read a page of public records with a string .subject pointing to this exact paper. */
export async function listPaperRecords(ref: PaperRef, collection: string, cursor?: string, signal?: AbortSignal) {
  if (!isValidNsid(collection)) throw new Error('Invalid collection.')
  const subject = ref.source === 'openalex' ? likeSubject(ref.id) : publicationUri(ref)
  const url = new URL('https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks')
  url.search = new URLSearchParams({ subject, source: collection + ':subject', limit: '10' }).toString()
  if (cursor) url.searchParams.set('cursor', cursor)
  const data = await publicJson(url, signal)
  if (!Array.isArray(data.records)) throw new Error('Invalid backlink page.')
  const next = nextCursor(data.cursor, cursor)
  const candidates = new Map<string, { did: string; rkey: string }>()
  for (const row of data.records) {
    const { did, rkey, collection: indexedCollection } = recordObject(row)
    if (indexedCollection !== collection || typeof did !== 'string' || !isValidDid(did) ||
        typeof rkey !== 'string' || !isValidRecordKey(rkey)) throw new Error('Invalid indexed record identity.')
    candidates.set(`at://${did}/${collection}/${rkey}`, { did, rkey })
  }
  const entries = [...candidates.entries()]
  const readers = new Map<string, ReturnType<typeof createPublicRepositoryClient>>()
  const results = await Promise.allSettled(entries.map(async ([, { did, rkey }]) => {
    const reader = readers.get(did) ?? createPublicRepositoryClient(did, { signal })
    readers.set(did, reader)
    const row = await (await reader).getRecord(collection, rkey, { signal })
    if (!row) return null
    const value = recordObject(row.value)
    return value.$type === collection && value.subject === subject ? { ...row, creatorDid: did } : null
  }))
  signal?.throwIfAborted()
  const records: (RepositoryRecord & { creatorDid: string })[] = []
  const failedUris: string[] = []
  results.forEach((result, index) => {
    if (result.status === 'rejected') failedUris.push(entries[index][0])
    else if (result.value) records.push(result.value)
  })
  return { records, failedUris, cursor: next }
}
