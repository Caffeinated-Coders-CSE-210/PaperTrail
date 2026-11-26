import { TID } from '@atproto/common-web'
import { isLexValue, lexEquals } from '@atproto/lex-data'
import { isValidDatetime, isValidRecordKey } from '@atproto/syntax'
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

export type PostAttempt = { did: string; comment: string; uri: string; rkey: string; createdAt: string }

export function restorePostAttempt(serialized: string | null, did: string, uri: string): PostAttempt | null {
  try {
    const value = JSON.parse(serialized ?? 'null')
    if (value && value.did === did && value.uri === uri && typeof value.comment === 'string' &&
        typeof value.rkey === 'string' && isValidRecordKey(value.rkey) &&
        typeof value.createdAt === 'string' && isValidDatetime(value.createdAt) && postContent(value.comment, uri).valid) return value
  } catch { /* Ignore invalid local recovery data. */ }
  return null
}

export function preparePost(did: string, fetchHandler: FetchHandler, comment: string, uri: string, previous?: PostAttempt) {
  if (previous && (previous.did !== did || previous.uri !== uri || previous.comment !== comment)) {
    throw new Error('The pending post belongs to a different account or paper.')
  }
  const { text, facets, valid } = postContent(comment, uri)
  if (!valid) throw new Error('Shorten your post before sharing.')
  const attempt = previous ?? { did, comment, uri, rkey: TID.nextStr(), createdAt: new Date().toISOString() }
  const { rkey, createdAt } = attempt
  const record = { $type: collection, text, facets, createdAt }
  const client = createRepositoryClient(did, fetchHandler)
  const postUrl = `https://bsky.app/profile/${did}/post/${rkey}`
  const send = async () => {
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
  return Object.assign(send, { attempt })
}
