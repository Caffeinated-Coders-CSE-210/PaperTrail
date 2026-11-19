import assert from 'node:assert/strict'
import test from 'node:test'
import { bookmarkStorageKey, createLocalBookmarkStorage } from './localBookmarks.ts'

const alice = 'did:plc:alicepapertrail'
const bob = 'did:plc:bobpapertrail'

function memoryStore() {
  const values = new Map()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

function paper(id, title = `Paper ${id}`) {
  return {
    id, title, authors: ['Ada Lovelace'], year: 2020, abstract: null, doi: null, url: null,
    publicationDate: null, researchArea: null, keywords: [], pdfUrl: null,
  }
}

test('a new account starts with an empty library', async () => {
  const storage = createLocalBookmarkStorage(alice, memoryStore())
  assert.deepEqual(await storage.listSavedPapers(), [])
})

test('saved papers persist for the same account and list newest first', async () => {
  const store = memoryStore()
  const first = createLocalBookmarkStorage(alice, store)
  await first.savePaper(paper('W1'))
  await first.savePaper(paper('W2'))

  const restored = createLocalBookmarkStorage(alice, store)
  assert.deepEqual((await restored.listSavedPapers()).map(({ id }) => id), ['W2', 'W1'])
})

test('saving a paper twice keeps one entry with the latest metadata', async () => {
  const storage = createLocalBookmarkStorage(alice, memoryStore())
  await storage.savePaper(paper('W1', 'Old title'))
  await storage.savePaper(paper('W2'))
  await storage.savePaper(paper('W1', 'New title'))

  const saved = await storage.listSavedPapers()
  assert.deepEqual(saved.map(({ id }) => id), ['W2', 'W1'])
  assert.equal(saved[1].title, 'New title')
})

test('removing a bookmark leaves the others, and removing a missing one succeeds', async () => {
  const storage = createLocalBookmarkStorage(alice, memoryStore())
  await storage.savePaper(paper('W1'))
  await storage.savePaper(paper('W2'))
  await storage.removeSavedPaper('W1')
  await storage.removeSavedPaper('W404')
  assert.deepEqual((await storage.listSavedPapers()).map(({ id }) => id), ['W2'])
})

test('each AT Protocol account has its own library', async () => {
  const store = memoryStore()
  await createLocalBookmarkStorage(alice, store).savePaper(paper('W1'))
  assert.deepEqual(await createLocalBookmarkStorage(bob, store).listSavedPapers(), [])
  assert.ok(store.values.has(bookmarkStorageKey(alice)))
})

test('unreadable or invalid stored data is ignored instead of breaking the page', async () => {
  const store = memoryStore()
  store.setItem(bookmarkStorageKey(alice), '{not json')
  assert.deepEqual(await createLocalBookmarkStorage(alice, store).listSavedPapers(), [])

  store.setItem(bookmarkStorageKey(alice), JSON.stringify([paper('W1'), { id: 'bad' }, null]))
  assert.deepEqual((await createLocalBookmarkStorage(alice, store).listSavedPapers()).map(({ id }) => id), ['W1'])
})

test('a failed write rejects so the UI can show an error', async () => {
  const store = { ...memoryStore(), setItem: () => { throw new Error('QuotaExceededError') } }
  await assert.rejects(createLocalBookmarkStorage(alice, store).savePaper(paper('W1')), /Quota/)
})
