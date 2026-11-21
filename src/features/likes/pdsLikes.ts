import type { FetchHandler } from '../auth/session.ts'
import { LIKE_COLLECTION, likeRecord } from './lexicon.ts'
import { LikePermissionError, type LikeStore } from './service.ts'

async function errorName(response: Response) {
  try {
    const body: { error?: unknown } = await response.json()
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

/** Stores likes as `app.papertrail.like` records in the account's PDS. */
export function createPdsLikeStore(did: string, fetchHandler: FetchHandler): LikeStore {
  async function write(method: string, body: Record<string, unknown>) {
    const response = await fetchHandler(`/xrpc/com.atproto.repo.${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.status === 403) throw new LikePermissionError('PaperTrail is not allowed to update your likes')
    if (!response.ok) throw new Error(`PDS ${method} failed (${response.status})`)
  }

  return {
    async hasLiked(id) {
      const params = new URLSearchParams({ repo: did, collection: LIKE_COLLECTION, rkey: id })
      const response = await fetchHandler(`/xrpc/com.atproto.repo.getRecord?${params}`)
      if (response.ok) return true
      if (response.status === 400 && await errorName(response) === 'RecordNotFound') return false
      throw new Error(`PDS getRecord failed (${response.status})`)
    },
    like(id) {
      return write('putRecord', { repo: did, collection: LIKE_COLLECTION, rkey: id, record: likeRecord(id) })
    },
    unlike(id) {
      return write('deleteRecord', { repo: did, collection: LIKE_COLLECTION, rkey: id })
    },
  }
}
