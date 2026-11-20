import assert from 'node:assert/strict'
import test from 'node:test'
import { createConstellationCounter } from './constellation.ts'
import { LIKE_COLLECTION, likeRecord, likeSubject } from './lexicon.ts'
import { createPdsLikeStore } from './pdsLikes.ts'
import { LikePermissionError } from './service.ts'

const did = 'did:plc:papertrailtester'
const paperId = 'W2741809807'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('a like points at the OpenAlex work it is for', () => {
  assert.equal(LIKE_COLLECTION, 'app.papertrail.like')
  assert.equal(likeSubject('W1'), 'https://openalex.org/W1')
  const now = new Date('2026-11-20T12:00:00.000Z')
  assert.deepEqual(likeRecord(paperId, now), {
    $type: 'app.papertrail.like',
    subject: 'https://openalex.org/W2741809807',
    createdAt: '2026-11-20T12:00:00.000Z',
  })
})

test('counts distinct accounts that liked a paper', async () => {
  let requested
  const counter = createConstellationCounter(async (url) => {
    requested = new URL(url)
    return json({ total: 7 })
  })
  assert.equal(await counter.countLikes(paperId), 7)
  assert.equal(requested.origin, 'https://constellation.microcosm.blue')
  assert.equal(requested.pathname, '/links/count/distinct-dids')
  assert.equal(requested.searchParams.get('target'), 'https://openalex.org/W2741809807')
  assert.equal(requested.searchParams.get('collection'), 'app.papertrail.like')
  assert.equal(requested.searchParams.get('path'), '.subject')
})

test('a failed or malformed count rejects', async () => {
  await assert.rejects(createConstellationCounter(async () => json({}, 503)).countLikes(paperId))
  await assert.rejects(createConstellationCounter(async () => json({ total: 'many' })).countLikes(paperId))
  await assert.rejects(createConstellationCounter(async () => new Response('not json')).countLikes(paperId))
  for (const total of [null, -1, 1.5]) {
    await assert.rejects(createConstellationCounter(async () => json({ total })).countLikes(paperId))
  }
  await assert.rejects(createConstellationCounter(async () => { throw new TypeError('Failed to fetch') }).countLikes(paperId))
})

test('a paper nobody liked has a count of zero', async () => {
  assert.equal(await createConstellationCounter(async () => json({ total: 0 })).countLikes(paperId), 0)
})

function pds(handler) {
  const calls = []
  const store = createPdsLikeStore(did, async (path, init) => {
    const url = new URL(path, 'https://pds.example')
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ method: init?.method ?? 'GET', url, body, headers: new Headers(init?.headers) })
    return handler({ url, body })
  })
  return { store, calls }
}

test('reads whether the account already liked a paper', async () => {
  const liked = pds(() => json({ uri: `at://${did}/app.papertrail.like/${paperId}`, value: {} }))
  assert.equal(await liked.store.hasLiked(paperId), true)
  const [{ method, url }] = liked.calls
  assert.equal(method, 'GET')
  assert.equal(url.pathname, '/xrpc/com.atproto.repo.getRecord')
  assert.equal(url.searchParams.get('repo'), did)
  assert.equal(url.searchParams.get('collection'), 'app.papertrail.like')
  assert.equal(url.searchParams.get('rkey'), paperId)

  const missing = pds(() => json({ error: 'RecordNotFound', message: 'Could not locate record' }, 400))
  assert.equal(await missing.store.hasLiked(paperId), false)
})

test('a failed like lookup rejects instead of reporting not liked', async () => {
  await assert.rejects(pds(() => json({ error: 'InternalServerError' }, 500)).store.hasLiked(paperId))
  await assert.rejects(pds(() => json({ error: 'InvalidRequest' }, 400)).store.hasLiked(paperId))
})

test('liking writes one record keyed by the paper ID', async () => {
  const { store, calls } = pds(() => json({ uri: 'at://x', cid: 'y' }))
  await store.like(paperId)
  await store.like(paperId)
  assert.equal(calls.length, 2)
  for (const { method, url, body, headers } of calls) {
    assert.equal(method, 'POST')
    assert.equal(headers.get('Content-Type'), 'application/json')
    assert.equal(url.pathname, '/xrpc/com.atproto.repo.putRecord')
    assert.equal(body.repo, did)
    assert.equal(body.collection, 'app.papertrail.like')
    assert.equal(body.rkey, paperId)
    assert.equal(body.record.$type, 'app.papertrail.like')
    assert.equal(body.record.subject, 'https://openalex.org/W2741809807')
    assert.ok(!Number.isNaN(Date.parse(body.record.createdAt)))
    // An unconditional put replaces an existing like instead of failing compare-and-swap.
    assert.equal('swapRecord' in body, false)
  }
})

test('unliking deletes the record for the paper', async () => {
  const { store, calls } = pds(() => json({}))
  await store.unlike(paperId)
  const [{ method, url, body, headers }] = calls
  assert.equal(method, 'POST')
  assert.equal(headers.get('Content-Type'), 'application/json')
  assert.equal(url.pathname, '/xrpc/com.atproto.repo.deleteRecord')
  assert.deepEqual(body, { repo: did, collection: 'app.papertrail.like', rkey: paperId })
})

test('failed writes reject', async () => {
  const { store } = pds(() => json({ error: 'InternalServerError' }, 500))
  await assert.rejects(store.like(paperId))
  await assert.rejects(store.unlike(paperId))
})

test('a write without the like scope rejects with a permission error', async () => {
  const responses = [
    () => json({ error: 'InsufficientScope' }, 403),
    () => json({ error: 'Forbidden', message: 'Missing repo permission' }, 403),
    () => new Response('Forbidden', { status: 403 }),
  ]
  for (const respond of responses) {
    const { store } = pds(respond)
    await assert.rejects(store.like(paperId), LikePermissionError)
    await assert.rejects(store.unlike(paperId), LikePermissionError)
  }
})

test('a network failure rejects', async () => {
  const store = createPdsLikeStore(did, async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(store.hasLiked(paperId))
  await assert.rejects(store.like(paperId))
  await assert.rejects(store.unlike(paperId))
})
