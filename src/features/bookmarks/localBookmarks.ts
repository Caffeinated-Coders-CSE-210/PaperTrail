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

/**
 * Bookmarks saved only in this browser, kept separate from the account's public bookmarks.
 * They stay listed until the user uploads or removes them.
 */
export interface BrowserBookmarkSource {
  /** Newest first. */
  list(): Promise<Paper[]>
  /** Removes a bookmark from this browser, after uploading it or when the user deletes it. */
  remove(id: PaperId): Promise<void>
  /** Whether the user chose to keep these bookmarks private, which hides the upload prompt. */
  isKeptLocal(): Promise<boolean>
  keepLocal(): Promise<void>
}

export function keptLocalKey(did: string) {
  return `papertrail.bookmarks.kept-local.v1:${did}`
}

export function createBrowserBookmarkSource(
  did: string,
  store: KeyValueStore = localStorage,
): BrowserBookmarkSource {
  const local = createLocalBookmarkStorage(did, store)
  return {
    list: () => local.listSavedPapers(),
    remove: (id) => local.removeSavedPaper(id),
    async isKeptLocal() {
      return store.getItem(keptLocalKey(did)) === 'true'
    },
    async keepLocal() {
      store.setItem(keptLocalKey(did), 'true')
    },
  }
}
