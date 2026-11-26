import test from 'node:test'
import assert from 'node:assert/strict'
import { listPaperRecords } from './discovery.ts'

const collection = 'app.papertrail.like'
const a = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const b = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
const cid = 'bafkreibjfgx2gprinfvicegelk5kosd6y2frmqpqzwqkg7usac74l3t2v4'
const candidate = (did, rkey) => ({ did, rkey, collection })

test('hydrates current records, checks subjects and preserves partial failures for retry', async t => {
  const paper = { source: 'publication', repoDid: a, rkey: 'paper-1' }
  const subject = `at://${a}/app.papertrail.paper/paper-1`
  const reads = []
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input)
    assert.equal(init.credentials, 'omit')
    if (url.host === 'constellation.microcosm.blue') {
      assert.equal(url.searchParams.get('subject'), subject)
      assert.equal(url.searchParams.get('source'), collection + ':subject')
      assert.equal(url.searchParams.get('cursor'), 'first')
      return Response.json({ records: [candidate(a, 'one'), candidate(a, 'one'), candidate(b, 'two'),
        candidate(a, 'moved'), candidate(b, 'deleted'), candidate(b, 'offline')], cursor: 'second' })
    }
    if (url.host === 'plc.directory') {
      const id = url.pathname.slice(1)
      return Response.json({ id, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] })
    }
    const did = url.searchParams.get('repo')
    const key = url.searchParams.get('rkey')
    reads.push(key)
    if (key === 'deleted') return Response.json({ error: 'RecordNotFound' }, { status: 400 })
    if (key === 'offline') return new Response(null, { status: 503 })
    return Response.json({ uri: `at://${did}/${collection}/${key}`, cid,
      value: { $type: collection, subject: key === 'moved' ? 'https://openalex.org/W2' : subject } })
  })
  const page = await listPaperRecords(paper, collection, 'first')
  assert.deepEqual(page.records.map(r => r.creatorDid), [a, b])
  assert.deepEqual(page.failedUris, [`at://${b}/${collection}/offline`])
  assert.equal(page.cursor, 'second')
  assert.equal(reads.filter(key => key === 'one').length, 1)
})
