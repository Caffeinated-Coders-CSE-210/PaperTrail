import { TID } from '@atproto/common-web'
import { isLexValue, lexEquals } from '@atproto/lex-data'
import type { FetchHandler } from '../auth/session.ts'
import { createRepositoryClient, PdsError } from '../repository/client.ts'

const collection = 'app.bsky.feed.post'
const encoder = new TextEncoder()
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function paperLink(url: string | null, doi: string | null, fallback: string) {
  const doiUrl = doi?.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
  for (const value of [url, doiUrl && /^10\.\d{4,9}\//.test(doiUrl) ? 'https://doi.org/' + doiUrl : null]) {
    if (!value) continue
    try {
      const link = new URL(value)
      if (['http:', 'https:'].includes(link.protocol) && !link.username && !link.password) return link.href
    } catch { /* Try the next paper identifier. */ }
  }
  return fallback
}

export function postContent(comment: string, uri: string) {
  // The fixed link label leaves room for comments even when a publisher URL is long.
  const prefix = comment.trim() ? comment.trim() + '\n\n' : ''
  const text = prefix + 'Read paper'
  const byteEnd = encoder.encode(text).length
  const count = [...segmenter.segment(text)].length
  return {
    count, valid: count <= 300 && byteEnd <= 3000,
    text, facets: [{ index: { byteStart: encoder.encode(prefix).length, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }] }],
  }
}

export function preparePost(did: string, fetchHandler: FetchHandler, comment: string, uri: string) {
  const { text, facets, valid } = postContent(comment, uri)
  if (!valid) throw new Error('Shorten your post before sharing.')
  const rkey = TID.nextStr()
  const record = { $type: collection, text, facets, createdAt: new Date().toISOString() }
  const client = createRepositoryClient(did, fetchHandler)
  const postUrl = `https://bsky.app/profile/${did}/post/${rkey}`
  return async () => {
    try {
      await client.createRecord(collection, rkey, record)
    } catch (error) {
      if (error instanceof PdsError && ['authentication', 'forbidden', 'permission', 'rate-limit'].includes(error.code)) throw error
      // A timeout or lost response may follow a successful create. Confirm the same record on retry.
      const existing = await client.getRecord(collection, rkey).catch(() => null)
      if (!existing || !isLexValue(existing.value) || !lexEquals(existing.value, record)) throw error
    }
    return postUrl
  }
}
