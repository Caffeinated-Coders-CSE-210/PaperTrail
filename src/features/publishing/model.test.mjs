import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { Lexicons, jsonToLex } from '@atproto/lexicon'
import { normalizeMetadata, publicationPath, publicationUri, parsePublication, PAPER_COLLECTION, validatePdfReference } from './model.ts'
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const cid = 'bafkreibjfgx2gprinfvicegelk5kosd6y2frmqpqzwqkg7usac74l3t2v4'
const blob = { $type: 'blob', ref: { $link: cid }, mimeType: 'application/pdf', size: 24 }

test('normalizes metadata without inventing an OpenAlex ID or a PDF URL', () => {
  assert.deepEqual(normalizeMetadata({ title: '  A paper  ', authors: [' Ada ', ''], keywords: [' AI ', 'AI'], doi: 'https://doi.org/10.1234/ABC' }), {
    title: 'A paper', authors: ['Ada'], year: null, abstract: null, doi: '10.1234/abc', url: null,
    publicationDate: null, researchArea: null, keywords: ['AI'],
  })
})
test('rejects missing authors, oversized strings, unsafe links and inconsistent dates', () => {
  for (const fields of [{ authors: [] }, { title: 'é'.repeat(501) }, { url: 'javascript:alert(1)' }, { publicationDate: '2025-02-30' }, { year: 2024, publicationDate: '2025-01-01' }]) {
    assert.throws(() => normalizeMetadata({ title: 'Paper', authors: ['Ada'], ...fields }))
  }
})
test('builds separately encoded publication paths and stable AT URIs', () => {
  const ref = { source: 'publication', repoDid: did, rkey: 'paper-1' }
  assert.equal(publicationPath(ref), '/publications/did%3Aplc%3Aaaaaaaaaaaaaaaaaaaaaaaaa/paper-1')
  assert.equal(publicationUri(ref), `at://${did}/${PAPER_COLLECTION}/paper-1`)
  assert.throws(() => publicationPath({ ...ref, rkey: '../x' }))
})
test('reads publisher identity from the requested record and preserves metadata independently of bytes', () => {
  const uri = `at://${did}/${PAPER_COLLECTION}/paper-1`
  const result = parsePublication({ uri, cid, value: { $type: PAPER_COLLECTION, title: 'Paper', authors: ['Ada'], pdf: blob, createdAt: '2026-11-23T00:00:00.000Z' } })
  assert.equal(result.ref.repoDid, did)
  assert.equal(result.metadata.abstract, null)
  assert.deepEqual(result.pdf, { kind: 'pds-blob', repoDid: did, blob })
  assert.throws(() => parsePublication({ uri, cid, value: { $type: 'other.app.paper' } }))
})
test('validates PDF blob CID flavor, MIME and size', () => {
  assert.deepEqual(validatePdfReference(blob), blob)
  for (const changed of [{ size: 0 }, { size: 5242881 }, { mimeType: 'text/html' }, { ref: { $link: 'invalid' } }]) assert.throws(() => validatePdfReference({ ...blob, ...changed }))
})
test('the formal Lexicon validates structure; domain validation also enforces PDF MIME', () => {
  const schema = JSON.parse(readFileSync(new URL('../../../lexicons/app.papertrail.paper.json', import.meta.url)))
  const lexicons = new Lexicons([schema])
  const value = { $type: PAPER_COLLECTION, title: 'Paper', authors: ['Ada'], pdf: blob, createdAt: '2026-11-23T00:00:00.000Z' }
  assert.equal(lexicons.validate(PAPER_COLLECTION, jsonToLex(value)).success, true)
  assert.equal(lexicons.validate(PAPER_COLLECTION, jsonToLex({ ...value, authors: [] })).success, false)
  // The locked SDK only checks BlobRef shape, not accept/maxSize. Enforce these in our boundary.
  assert.throws(() => parsePublication({ uri: `at://${did}/${PAPER_COLLECTION}/paper-1`, cid, value: { ...value, pdf: { ...blob, mimeType: 'text/html' } } }))
})

test('rejects timestamps that are parseable by JavaScript but lack protocol-required seconds', () => {
  assert.throws(() => parsePublication({ uri: `at://${did}/${PAPER_COLLECTION}/paper-1`, cid, value: { $type: PAPER_COLLECTION, title: 'Paper', authors: ['Ada'], pdf: blob, createdAt: '2026-11-23T00:00Z' } }))
})
