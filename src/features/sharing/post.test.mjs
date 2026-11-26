import test from 'node:test'
import assert from 'node:assert/strict'
import { paperLink, postContent, preparePost } from './post.ts'

const link = 'https://openalex.org/W7'
test('retains a clickable link with edited Unicode text or an empty comment', () => {
  for (const draft of ['中文 👩🏽‍🔬', '']) {
    const { text, facets, valid } = postContent(draft, link)
    const { byteStart, byteEnd } = facets[0].index
    assert.equal(Buffer.from(text).subarray(byteStart, byteEnd).toString(), 'Read paper')
    assert.equal(facets[0].features[0].uri, link)
    assert.equal(valid, true)
  }
  assert.equal(postContent('👩🏽‍🔬'.repeat(289), link).valid, false)
  assert.equal(postContent('a'.repeat(288), link).valid, true)
  assert.equal(postContent('a'.repeat(289), link).valid, false)
  assert.equal(paperLink('javascript:no', '10.1234/test', link), 'https://doi.org/10.1234/test')
  assert.equal(paperLink(null, null, link), link)
})

test('confirms an ambiguous write against the same account, key and content', async () => {
  const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
  const cid = 'bafkreibjfgx2gprinfvicegelk5kosd6y2frmqpqzwqkg7usac74l3t2v4'
  let write
  const send = preparePost(did, async (path, init) => {
    if (path.endsWith('createRecord')) {
      write = JSON.parse(init.body)
      throw new Error('response lost')
    }
    assert.equal(new URL(path, 'https://example.org').searchParams.get('rkey'), write.rkey)
    return Response.json({ uri: `at://${did}/app.bsky.feed.post/${write.rkey}`, cid, value: write.record })
  }, 'A good read', link)
  const url = await send()
  assert.equal(write.repo, did)
  assert.equal(write.collection, 'app.bsky.feed.post')
  assert.equal(url, `https://bsky.app/profile/${did}/post/${write.rkey}`)
})
