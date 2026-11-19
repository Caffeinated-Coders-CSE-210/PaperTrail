import type { Paper } from '../../shared/paper'
import type { BookmarkStorage } from './storage'

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

const KEY_PREFIX = 'papertrail.bookmarks.v1:'

/** Each AT Protocol account gets its own library in this browser. */
export function bookmarkStorageKey(did: string) {
  return `${KEY_PREFIX}${did}`
}

function isPaper(value: unknown): value is Paper {
  if (!value || typeof value !== 'object') return false
  const { id, title, authors } = value as Partial<Paper>
  return typeof id === 'string' && /^W\d+$/.test(id) && typeof title === 'string' && Array.isArray(authors)
}

/**
 * Browser-local bookmarks for the demo, keyed by the signed-in account's DID.
 * Papers are listed newest first. Saving a paper again refreshes its entry in place.
 */
export function createLocalBookmarkStorage(
  did: string,
  store: KeyValueStore = localStorage,
): BookmarkStorage {
  const key = bookmarkStorageKey(did)

  function read(): Paper[] {
    const raw = store.getItem(key)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isPaper) : []
    } catch {
      return []
    }
  }

  function write(papers: Paper[]) {
    store.setItem(key, JSON.stringify(papers))
  }

  return {
    async listSavedPapers() {
      return read()
    },

    async savePaper(paper) {
      const papers = read()
      const index = papers.findIndex((saved) => saved.id === paper.id)
      if (index === -1) papers.unshift(paper)
      else papers[index] = paper
      write(papers)
    },

    async removeSavedPaper(id) {
      write(read().filter((saved) => saved.id !== id))
    },
  }
}
