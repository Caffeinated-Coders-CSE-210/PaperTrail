import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { cidForRawBytes } from '@atproto/lex-data'
import { validatePdfFile, uploadPdf, retrievePdf } from './pdf.ts'
const bytes = readFileSync(new URL('../../../tests/reader/sample.pdf', import.meta.url))
const cid = (await cidForRawBytes(bytes)).toString()
const blob = { $type: 'blob', ref: { $link: cid }, mimeType: 'application/pdf', size: bytes.length }
const file = () => new File([bytes], 'paper.pdf', { type: 'application/pdf' })
test('validates a fixed real PDF, including files whose browser MIME is empty', async () => {
  await validatePdfFile(file())
  await validatePdfFile(new File([bytes], 'paper.PDF'))
})
test('rejects empty, non-PDF, mislabeled and over-limit files before uploading', async () => {
  for (const input of [new File([], 'empty.pdf'), new File(['<html>'], 'fake.pdf'), new File([bytes], 'paper.txt'), new File([bytes], 'paper.pdf', { type: 'text/html' }), new File([new Uint8Array(5242881)], 'large.pdf')]) await assert.rejects(validatePdfFile(input))
  await assert.rejects(validatePdfFile(file(), bytes.length - 1))
})
test('uploads raw bytes, respects the advertised limit and verifies the returned blob content identity', async () => {
  const requests = []
  const handler = async (path, init) => {
    requests.push({ path, init })
    if (path.includes('describeServer')) return Response.json({ blobUploadLimit: 314572800 })
    assert.equal(init.headers['Content-Type'], 'application/pdf')
    assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()), new Uint8Array(bytes))
    return Response.json({ blob })
  }
  assert.deepEqual(await uploadPdf(file(), handler), blob)
  assert.equal(requests[1].path, '/xrpc/com.atproto.repo.uploadBlob')
  await assert.rejects(uploadPdf(file(), async path => path.includes('describeServer') ? Response.json({ blobUploadLimit: 10 }) : assert.fail('must not upload')))
  await assert.rejects(uploadPdf(file(), async path => path.includes('describeServer') ? Response.json({}) : Response.json({ blob: { ...blob, size: 7 } })))
})
test('retrieves bounded PDF bytes without credentials and verifies MIME, size and hash', async () => {
  const result = await retrievePdf('https://pds.example.test', 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', blob, async (url, init) => {
    assert.match(String(url), /com.atproto.sync.getBlob\?did=/)
    assert.equal(init.credentials, 'omit')
    assert.equal(init.headers, undefined)
    return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } })
  })
  assert.equal(result.type, 'application/pdf')
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array(bytes))
})
test('rejects HTML errors, unavailable documents, truncated data and content mismatch', async () => {
  for (const response of [new Response('<html>', { headers: { 'Content-Type': 'text/html' } }), Response.json({ error: 'BlobNotFound' }, { status: 400 }), new Response(bytes.subarray(0, 8), { headers: { 'Content-Type': 'application/pdf' } }), new Response(new Uint8Array(bytes.length).fill(32), { headers: { 'Content-Type': 'application/pdf' } })]) await assert.rejects(retrievePdf('https://pds.example.test', 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', blob, async () => response))
})
