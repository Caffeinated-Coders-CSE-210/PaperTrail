import type { RepositoryClient } from '../repository/client.ts'
import { BOOKMARK_COLLECTION, bookmarkRecord, parseBookmark, type ParsedBookmark } from './lexicon.ts'
import type { BookmarkStorage } from './storage.ts'

type BookmarkRepository = Pick<RepositoryClient, 'listRecords' | 'putRecord' | 'deleteRecord'>

const PAGE_SIZE = 100
/** Stops a misbehaving server from paging forever. 50 pages is 5,000 bookmarks. */
const MAX_PAGES = 50

/**
 * Stores bookmarks as public `app.papertrail.bookmark` records in the account's PDS,
 * so the library follows the account across devices.
 */
export function createPdsBookmarkStorage(repository: BookmarkRepository): BookmarkStorage {
  return {
    async listSavedPapers() {
      const bookmarks: ParsedBookmark[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await repository.listRecords(BOOKMARK_COLLECTION, { limit: PAGE_SIZE, cursor })
        for (const { uri, value } of result.records) {
          const parsed = parseBookmark(uri.slice(uri.lastIndexOf('/') + 1), value)
          if (parsed) bookmarks.push(parsed)
        }
        cursor = result.cursor
        if (!cursor) break
      }
      // A partial list would silently hide older bookmarks, so fail visibly instead.
      if (cursor) throw new Error(`More than ${MAX_PAGES * PAGE_SIZE} bookmarks; the saved list is incomplete.`)
      return bookmarks
        // Imports can share a timestamp, so the paper ID keeps the order stable.
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.paper.id.localeCompare(b.paper.id))
        .map(({ paper }) => paper)
    },

    async savePaper(paper) {
      // The paper ID is the record key, so saving again replaces the same record.
      await repository.putRecord(BOOKMARK_COLLECTION, paper.id, { ...bookmarkRecord(paper) })
    },

    async removeSavedPaper(id) {
      await repository.deleteRecord(BOOKMARK_COLLECTION, id)
    },
  }
}
