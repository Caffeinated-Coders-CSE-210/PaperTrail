import assert from 'node:assert/strict'
import test from 'node:test'
import { createRepositoryClient, PdsError, resolvePds } from './client.ts'
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const cid = 'bafkreibjfgx2gprinfvicegelk5kosd6y2frmqpqzwqkg7usac74l3t2v4'
const collection = 'app.papertrail.paper'
const uri = `at://${did}/${collection}/key-1`
const envelope = { uri, cid, value: { $type: collection, title: 'Paper' } }
const json = (data, status = 200) => Response.json(data, { status })

test('CRUD binds writes to its account, retains returned identity and forwards concurrency conditions', async () => {
  const requests = []
  const client = createRepositoryClient(did, async (path, init) => {
    requests.push({ path, init, body: init?.body && JSON.parse(init.body) })
    if (path.includes('getRecord')) return json(envelope)
    if (path.includes('listRecords')) return json({ records: [envelope], cursor: 'next' })
    if (path.includes('deleteRecord')) return new Response(null, { status: 200 })
    return json({ uri, cid })
  })
  assert.deepEqual(await client.createRecord(collection, 'key-1', envelope.value), { uri, cid })
  assert.deepEqual(await client.getRecord(collection, 'key-1'), envelope)
  assert.deepEqual(await client.listRecords(collection, { cursor: 'previous', limit: 10 }), { records: [envelope], cursor: 'next' })
  await client.putRecord(collection, 'key-1', envelope.value, cid)
  await client.deleteRecord(collection, 'key-1', cid)
  assert.equal(requests[0].body.repo, did)
  assert.equal(requests[0].path, '/xrpc/com.atproto.repo.createRecord')
  assert.equal(requests[3].body.swapRecord, cid)
  assert.equal(requests[4].body.swapRecord, cid)
  assert.match(requests[2].path, /cursor=previous/)
})
test('returns null only for the documented RecordNotFound response', async () => {
  for (const [status, error, missing] of [[400,'RecordNotFound',true], [404,'NotFound',false], [403,'Forbidden',false], [400,'InvalidRequest',false]]) {
    const client = createRepositoryClient(did, async () => json({ error }, status))
    if (missing) assert.equal(await client.getRecord(collection, 'key-1'), null)
    else await assert.rejects(client.getRecord(collection, 'key-1'), PdsError)
  }
})
test('preserves API codes, distinguishes insufficient scope, and rejects malformed success payloads', async () => {
  const permission = createRepositoryClient(did, async () => json({ error: 'InsufficientScope' }, 403))
  await assert.rejects(permission.createRecord(collection, 'key-1', envelope.value), e => e.code === 'permission' && e.status === 403 && e.protocolCode === 'InsufficientScope')
  const malformed = createRepositoryClient(did, async () => json({ records: [] }))
  await assert.rejects(malformed.createRecord(collection, 'key-1', envelope.value), e => e.code === 'invalid-response')
})
test('rejects invalid collection/rkey, mismatched record identities and bad cursors', async () => {
  let calls = 0
  const client = createRepositoryClient(did, async () => { calls++; return json({ ...envelope, uri: uri.replace('key-1','other') }) })
  await assert.rejects(client.getRecord('https://evil.test', 'key-1'))
  await assert.rejects(client.getRecord(collection, '../key'))
  assert.equal(calls, 0)
  await assert.rejects(client.getRecord(collection, 'key-1'), e => e.code === 'invalid-response')
  const badList = createRepositoryClient(did, async () => json({ records: [envelope], cursor: 123 }))
  await assert.rejects(badList.listRecords(collection), e => e.code === 'invalid-response')
})
test('public reads resolve the owner PDS without attaching credentials', async () => {
  const seen = []
  const endpoint = await resolvePds(did, async (url, init) => {
    seen.push({ url: String(url), init })
    return json({ id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.test' }] })
  })
  assert.equal(endpoint, 'https://pds.example.test')
  assert.equal(seen[0].url, `https://plc.directory/${did}`)
  assert.equal(seen[0].init.credentials, 'omit')
})
test('DID resolution rejects substituted identities, unsafe PDS endpoints and unsupported DID methods', async () => {
  for (const doc of [{ id: 'did:plc:other' }, { id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'http://evil.test' }] }]) await assert.rejects(resolvePds(did, async () => json(doc)))
  await assert.rejects(resolvePds('did:key:unsupported', async () => { throw new Error('should not fetch') }))
})

test('an explicit caller cancellation signal does not disable the request deadline', async () => {
  const originalTimeout = AbortSignal.timeout
  const deadline = AbortSignal.abort(new DOMException('Deadline exceeded', 'TimeoutError'))
  AbortSignal.timeout = () => deadline
  try {
    const caller = new AbortController()
    const client = createRepositoryClient(did, async (_path, init) => { init.signal.throwIfAborted(); return json(envelope) })
    await assert.rejects(client.getRecord(collection, 'key-1', { signal: caller.signal }), e => e.code === 'network')
    assert.equal(caller.signal.aborted, false)
  } finally { AbortSignal.timeout = originalTimeout }
})
