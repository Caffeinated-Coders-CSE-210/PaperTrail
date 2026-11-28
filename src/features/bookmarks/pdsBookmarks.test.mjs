import assert from 'node:assert/strict'
import test from 'node:test'
import { createRepositoryClient, PdsError } from '../repository/client.ts'
import { BOOKMARK_COLLECTION, bookmarkRecord, parseBookmark } from './lexicon.ts'
import { createBrowserBookmarkSource, createLocalBookmarkStorage } from './localBookmarks.ts'
import { createPdsBookmarkStorage } from './pdsBookmarks.ts'

const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const cid = 'bafkreibjfgx2gprinfvicegelk5kosd6y2frmqpqzwqkg7usac74l3t2v4'

function paper(id, overrides = {}) {
  return {
    id, title: `Paper ${id}`, authors: ['Ada Lovelace'], year: 2020, abstract: 'Long abstract', doi: null, url: null,
    publicationDate: null, researchArea: 'Computer Science', keywords: [], pdfUrl: null, ...overrides,
  }
}

/** In-memory PDS behind the real repository client, so requests use the actual XRPC shapes. */
function fakePds({ pageSize = 100, fail } = {}) {
  const records = new Map()
  const requests = []
  const fetchHandler = async (path, init = {}) => {
    const url = new URL(path, 'https://pds.test')
    const method = url.pathname.split('.').pop()
    const body = init.body ? JSON.parse(init.body) : null
    requests.push({ method, params: Object.fromEntries(url.searchParams), body })
    if (fail?.[method]) return Response.json({ error: fail[method].error }, { status: fail[method].status })
    if (method === 'putRecord') {
      records.set(body.rkey, body.record)
      return Response.json({ uri: `at://${did}/${body.collection}/${body.rkey}`, cid })
    }
    if (method === 'deleteRecord') {
      records.delete(body.rkey)
      return Response.json({})
    }
    if (method === 'listRecords') {
      const all = [...records].map(([rkey, value]) => ({ uri: `at://${did}/${BOOKMARK_COLLECTION}/${rkey}`, cid, value }))
      const start = Number(url.searchParams.get('cursor') ?? 0)
      const end = start + Math.min(pageSize, Number(url.searchParams.get('limit')))
      return Response.json({ records: all.slice(start, end), ...(end < all.length ? { cursor: String(end) } : {}) })
    }
    throw new Error(`Unexpected ${method}`)
  }
  return { records, requests, storage: createPdsBookmarkStorage(createRepositoryClient(did, fetchHandler)) }
}

function memoryStore() {
  const values = new Map()
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, String(value)) } }
}

test('records copy display metadata, omit nulls and the abstract, and round-trip', () => {
  const record = bookmarkRecord(paper('W1', { doi: 'https://doi.org/10.1/x' }), new Date('2026-01-02T03:04:05Z'))
  assert.deepEqual(record, {
    $type: BOOKMARK_COLLECTION,
    subject: 'https://openalex.org/W1',
    paper: { title: 'Paper W1', authors: ['Ada Lovelace'], year: 2020, doi: 'https://doi.org/10.1/x', researchArea: 'Computer Science' },
    createdAt: '2026-01-02T03:04:05.000Z',
  })
  assert.deepEqual(parseBookmark('W1', record).paper, paper('W1', { doi: 'https://doi.org/10.1/x', abstract: null }))
})

test('records that cannot be displayed are skipped instead of failing the list', () => {
  const valid = bookmarkRecord(paper('W1'))
  assert.equal(parseBookmark('not-a-paper', valid), null)
  assert.equal(parseBookmark('W1', { ...valid, $type: 'app.other' }), null)
  assert.equal(parseBookmark('W1', { ...valid, paper: { authors: [] } }), null)
  assert.equal(parseBookmark('W1', null), null)
})

test('saving writes one record keyed by paper ID, so saving twice keeps one bookmark', async () => {
  const pds = fakePds()
  await pds.storage.savePaper(paper('W1'))
  await pds.storage.savePaper(paper('W1', { title: 'Updated' }))
  assert.deepEqual([...pds.records.keys()], ['W1'])
  const put = pds.requests.find((request) => request.method === 'putRecord')
  assert.equal(put.body.repo, did)
  assert.equal(put.body.collection, BOOKMARK_COLLECTION)
  assert.deepEqual((await pds.storage.listSavedPapers()).map(({ title }) => title), ['Updated'])
})

test('lists every page, newest first, and removes bookmarks', async () => {
  const pds = fakePds({ pageSize: 2 })
  for (const [id, day] of [['W1', '01'], ['W2', '03'], ['W3', '02']]) {
    pds.records.set(id, bookmarkRecord(paper(id), new Date(`2026-01-${day}T00:00:00Z`)))
  }
  pds.records.set('W9', { $type: BOOKMARK_COLLECTION, broken: true })
  assert.deepEqual((await pds.storage.listSavedPapers()).map(({ id }) => id), ['W2', 'W3', 'W1'])
  assert.equal(pds.requests.filter((request) => request.method === 'listRecords').length, 2)

  await pds.storage.removeSavedPaper('W2')
  assert.deepEqual((await pds.storage.listSavedPapers()).map(({ id }) => id), ['W3', 'W1'])
})

test('missing permission rejects with a permission error the UI can explain', async () => {
  const pds = fakePds({ fail: { putRecord: { status: 403, error: 'InsufficientScope' } } })
  await assert.rejects(pds.storage.savePaper(paper('W1')), (error) => error instanceof PdsError && error.code === 'permission')
})

test('load failures reject so the saved page can offer a retry', async () => {
  const pds = fakePds({ fail: { listRecords: { status: 500, error: 'InternalServerError' } } })
  await assert.rejects(pds.storage.listSavedPapers(), PdsError)
})

test('browser bookmarks stay listed after the user keeps them private', async () => {
  const store = memoryStore()
  const local = createLocalBookmarkStorage(did, store)
  await local.savePaper(paper('W1'))
  await local.savePaper(paper('W2'))

  const source = createBrowserBookmarkSource(did, store)
  assert.deepEqual((await source.list()).map(({ id }) => id), ['W2', 'W1'])
  assert.equal(await source.isKeptLocal(), false)
  await source.remove('W2')
  assert.deepEqual((await source.list()).map(({ id }) => id), ['W1'])

  await source.keepLocal()
  assert.equal(await source.isKeptLocal(), true)
  assert.deepEqual((await source.list()).map(({ id }) => id), ['W1'], 'kept bookmarks remain available')
  assert.equal(await createBrowserBookmarkSource('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', store).isKeptLocal(), false)
})

test('an account with more bookmarks than the page limit fails visibly instead of hiding older ones', async () => {
  const pds = fakePds({ pageSize: 1 })
  for (let index = 1; index <= 51; index += 1) pds.records.set(`W${index}`, bookmarkRecord(paper(`W${index}`)))
  await assert.rejects(pds.storage.listSavedPapers(), /incomplete/)
})

test('bookmarks saved in the same millisecond keep a stable order', async () => {
  const pds = fakePds()
  const now = new Date('2026-01-01T00:00:00Z')
  for (const id of ['W3', 'W1', 'W2']) pds.records.set(id, bookmarkRecord(paper(id), now))
  assert.deepEqual((await pds.storage.listSavedPapers()).map(({ id }) => id), ['W1', 'W2', 'W3'])
})
