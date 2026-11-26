import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { cidForRawBytes } from '@atproto/lex-data'
import { createPublicationService } from './service.ts'
import { PAPER_COLLECTION } from './model.ts'
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const bytes = readFileSync(new URL('../../../tests/reader/sample.pdf', import.meta.url))
const cid = (await cidForRawBytes(bytes)).toString()
const blob = { $type: 'blob', ref: { $link: cid }, mimeType: 'application/pdf', size: bytes.length }
const file = () => new File([bytes], 'sample.pdf', { type: 'application/pdf' })
function setup(options = {}) {
  const records = new Map(); const writes = []; let uploads = 0; let active = true
  const handler = async (path, init) => {
    if (path.includes('describeServer')) return Response.json({ blobUploadLimit: 5242880 })
    if (path.includes('uploadBlob')) { uploads++; await options.onUpload?.(); return Response.json({ blob }) }
    if (path.includes('getRecord')) { await options.onRead?.(); const key = new URL(path, 'https://pds.test').searchParams.get('rkey'); return records.has(key) ? Response.json(records.get(key)) : Response.json({ error: 'RecordNotFound' }, { status: 400 }) }
    if (path.includes('listRecords')) return Response.json({ records: [...records.values()], cursor: 'next' })
    const body = JSON.parse(init.body); writes.push(body)
    const row = { uri: `at://${did}/${PAPER_COLLECTION}/${body.rkey}`, cid, value: body.record }
    if (options.beforeWrite) { const rejection = await options.beforeWrite({ records, body, row, writes }); if (rejection) return rejection }
    records.set(body.rkey, row)
    if (options.afterWrite) await options.afterWrite()
    return Response.json({ uri: row.uri, cid })
  }
  const service = createPublicationService({ did, fetchHandler: handler, isActive: () => active }, { newKey: () => 'stable-key', now: () => '2026-11-23T00:00:00.000Z' })
  return { service, records, writes, get uploads() { return uploads }, deactivate: () => { active = false } }
}
test('publishes normalized metadata and a durable PDF reference once, including concurrent submissions', async () => {
  const s = setup(); const attempt = s.service.prepare({ title: ' Paper ', authors: ['Ada'] }, file())
  const [a, b] = await Promise.all([attempt.publish(), attempt.publish()])
  assert.equal(a.uri, `at://${did}/${PAPER_COLLECTION}/stable-key`)
  assert.equal(b.uri, a.uri); assert.equal(s.uploads, 1); assert.equal(s.writes.length, 1)
  assert.equal(s.writes[0].record.title, 'Paper'); assert.deepEqual(s.writes[0].record.pdf, blob)
  assert.equal('abstract' in s.writes[0].record, false)
})
test('recovers an unknown write result by querying the same key rather than creating a duplicate', async () => {
  const s = setup({ afterWrite: () => { throw new TypeError('connection lost') } })
  const result = await s.service.prepare({ title: 'Paper', authors: ['Ada'] }, file()).publish()
  assert.equal(result.ref.rkey, 'stable-key'); assert.equal(s.writes.length, 1)
})
test('retains the uploaded blob after a known failure and retries the same record identity', async () => {
  const s = setup({ beforeWrite: ({ writes }) => { if (writes.length === 1) throw new TypeError('unavailable') } })
  const attempt = s.service.prepare({ title: 'Paper', authors: ['Ada'] }, file())
  await assert.rejects(attempt.publish())
  await attempt.publish()
  assert.equal(s.uploads, 1); assert.deepEqual(s.writes.map(x => x.rkey), ['stable-key','stable-key'])
})
test('does not overwrite a different record at a reserved key', async () => {
  const s = setup()
  s.records.set('stable-key', { uri: `at://${did}/${PAPER_COLLECTION}/stable-key`, cid, value: { $type: PAPER_COLLECTION, title: 'Different', authors: ['Ada'], pdf: blob, createdAt: '2026-11-23T00:00:00.000Z' } })
  await assert.rejects(s.service.prepare({ title: 'Paper', authors: ['Ada'] }, file()).publish(), e => e.code === 'conflict')
  assert.equal(s.writes.length, 0)
})
test('stops before the record write if the account changes during upload', async () => {
  let s; s = setup({ onUpload: () => s.deactivate() })
  await assert.rejects(s.service.prepare({ title: 'Paper', authors: ['Ada'] }, file()).publish())
  assert.equal(s.writes.length, 0)
})
test('rejects signed-out publication and returns PDS pages without global discovery', async () => {
  const publicService = createPublicationService(null)
  assert.throws(() => publicService.prepare({ title: 'Paper', authors: ['Ada'] }, file()))
  const s = setup(); await s.service.prepare({ title: 'Paper', authors: ['Ada'] }, file()).publish()
  const page = await s.service.listMyPublications()
  assert.equal(page.publications[0].metadata.title, 'Paper'); assert.equal(page.cursor, 'next')
})
test('reuploads a temporary blob rejected as missing while preserving the publication key', async () => {
  const s = setup({ beforeWrite: ({ writes }) => writes.length === 1 ? Response.json({ error: 'BlobNotFound' }, { status: 400 }) : undefined })
  // The adapter preserves the protocol error instead of relying on error message text.
  const attempt = s.service.prepare({ title: 'Paper', authors: ['Ada'] }, file())
  await assert.rejects(attempt.publish()); await attempt.publish()
  assert.equal(s.writes[1].rkey, 'stable-key'); assert.equal(s.uploads, 2)
})

test('rejects malformed publication references before any public network requests', async () => {
  let calls = 0
  const service = createPublicationService(null, { fetchFn: async () => { calls++; throw new Error('Unexpected network') } })
  await assert.rejects(service.getPublication({ source: 'publication', repoDid: did, rkey: '../bad' }))
  await assert.rejects(service.getPublicationPdf({ source: 'publication', repoDid: did, rkey: '../bad' }))
  assert.equal(calls, 0)
})

for (const protocolCode of ['BlobNotFound', 'InvalidBlob']) {
  test(`reuploads after ${protocolCode} even when the recovery read fails`, async () => {
    let reads = 0
    const s = setup({
      onRead: () => { if (++reads === 2) throw new TypeError('recovery read unavailable') },
      beforeWrite: ({ writes }) => writes.length === 1 ? Response.json({ error: protocolCode }, { status: 400 }) : undefined,
    })
    const attempt = s.service.prepare({ title: 'Paper', authors: ['Ada'] }, file())
    await assert.rejects(attempt.publish())
    const result = await attempt.publish()
    assert.equal(result.ref.rkey, 'stable-key')
    assert.equal(s.uploads, 2)
    assert.deepEqual(s.writes.map(row => row.rkey), ['stable-key', 'stable-key'])
  })
}
