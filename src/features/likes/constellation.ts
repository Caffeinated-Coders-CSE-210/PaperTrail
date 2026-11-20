import type { PaperId } from '../../shared/paper'
import { LIKE_COLLECTION, likeSubject } from './lexicon.ts'
import type { LikeCounter } from './service.ts'

const CONSTELLATION_API_URL = 'https://constellation.microcosm.blue'

export function createConstellationCounter(fetchFn: typeof fetch = (...args) => fetch(...args)): LikeCounter {
  return {
    async countLikes(id: PaperId) {
      const url = new URL('/links/count/distinct-dids', CONSTELLATION_API_URL)
      url.searchParams.set('target', likeSubject(id))
      url.searchParams.set('collection', LIKE_COLLECTION)
      url.searchParams.set('path', '.subject')

      const response = await fetchFn(url)
      if (!response.ok) throw new Error(`Constellation request failed (${response.status})`)
      const data: { total?: unknown } = await response.json()
      const { total } = data
      if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
        throw new Error('Unexpected response from Constellation')
      }
      return total
    },
  }
}

export const constellationLikeCounter = createConstellationCounter()
