import type { Paper, PaperId } from '../../shared/paper'
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

/** Browser bookmarks waiting for the user to upload them to their account or keep them private. */
export interface BookmarkImportSource {
  /** Local bookmarks to offer for upload, newest first. Empty once the user keeps them private. */
  listPending(): Promise<Paper[]>
  /** Removes a bookmark from this browser after it reaches the account. */
  markUploaded(id: PaperId): Promise<void>
  /** Keeps the remaining bookmarks in this browser and stops offering them. */
  keepLocal(): Promise<void>
}

export function importDismissedKey(did: string) {
  return `papertrail.bookmarks.import-dismissed.v1:${did}`
}

export function createLocalImportSource(
  did: string,
  store: KeyValueStore = localStorage,
): BookmarkImportSource {
  const local = createLocalBookmarkStorage(did, store)
  return {
    async listPending() {
      if (store.getItem(importDismissedKey(did)) === 'true') return []
      return local.listSavedPapers()
    },
    markUploaded: (id) => local.removeSavedPaper(id),
    async keepLocal() {
      store.setItem(importDismissedKey(did), 'true')
    },
  }
}
