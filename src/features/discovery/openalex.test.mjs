import assert from 'node:assert/strict'
import test from 'node:test'
import { listDefaultPapers, normalizePaper, openAlexPaperService } from './openalex.ts'

const work = {
  id: 'https://openalex.org/W2741809807',
  title: 'Example Paper',
  authorships: [
    { author: { display_name: 'Alice Chen' } },
    { author: { display_name: 'Bob Lee' } },
  ],
  publication_year: 2024,
  publication_date: '2024-05-10',
  abstract_inverted_index: { world: [1], Hello: [0] },
  doi: 'https://doi.org/10.1234/example',
  primary_topic: { field: { display_name: 'Computer Science' } },
  keywords: [{ display_name: 'Computer vision' }],
  best_oa_location: {
    landing_page_url: 'https://example.org/paper',
    pdf_url: 'https://example.org/paper.pdf',
  },
}

test('normalizes OpenAlex metadata to the shared Paper format', () => {
  assert.deepEqual(normalizePaper(work), {
    id: 'W2741809807',
    title: 'Example Paper',
    authors: ['Alice Chen', 'Bob Lee'],
    year: 2024,
    abstract: 'Hello world',
    doi: 'https://doi.org/10.1234/example',
    url: 'https://example.org/paper',
    publicationDate: '2024-05-10',
    researchArea: 'Computer Science',
    keywords: ['Computer vision'],
    pdfUrl: 'https://example.org/paper.pdf',
  })
})

test('keeps missing metadata nullable and never replaces a missing PDF with a landing page', () => {
  const paper = normalizePaper({ id: 'https://openalex.org/W123', primary_location: { landing_page_url: 'https://example.org/work' } })
  assert.equal(paper.id, 'W123')
  assert.deepEqual(paper.authors, [])
  assert.equal(paper.abstract, null)
  assert.equal(paper.researchArea, null)
  assert.deepEqual(paper.keywords, [])
  assert.equal(paper.url, 'https://example.org/work')
  assert.equal(paper.pdfUrl, null)
})

test('uses separate OpenAlex parameters for paper and author searches', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(new URL(url))
    return new Response(JSON.stringify({ results: [work] }), { status: 200 })
  }
  try {
    assert.equal((await openAlexPaperService.searchPapers(' computer vision '))[0].id, 'W2741809807')
    assert.equal((await openAlexPaperService.searchPapers('Geoffrey Hinton', 'author'))[0].id, 'W2741809807')
    assert.equal(urls[0].searchParams.get('search'), 'computer vision')
    assert.equal(urls[0].searchParams.get('page'), '1')
    assert.equal(urls[1].searchParams.get('filter'), 'raw_author_name.search:"Geoffrey Hinton"')
    assert.deepEqual(await openAlexPaperService.searchPapers('  '), [])
    assert.equal(urls.length, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('loads default papers without a search query or author filter', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url)
    return new Response(JSON.stringify({ results: [work] }), { status: 200 })
  }
  try {
    const papers = await listDefaultPapers()
    assert.equal(papers.length, 1)
    assert.equal(papers[0].id, 'W2741809807')
    assert.equal(requestedUrl.pathname, '/works')
    assert.equal(requestedUrl.searchParams.get('per_page'), '20')
    assert.equal(requestedUrl.searchParams.get('page'), '1')
    assert.equal(requestedUrl.searchParams.has('search'), false)
    assert.equal(requestedUrl.searchParams.has('filter'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('requests a later default page without search parameters', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url)
    return new Response(JSON.stringify({ results: [work] }))
  }
  try {
    await listDefaultPapers(2)
    assert.equal(requestedUrl.searchParams.get('page'), '2')
    assert.equal(requestedUrl.searchParams.get('per_page'), '20')
    assert.equal(requestedUrl.searchParams.has('search'), false)
    assert.equal(requestedUrl.searchParams.has('filter'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('preserves paper and author searches on later pages', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(new URL(url))
    return new Response(JSON.stringify({ results: [work] }))
  }
  try {
    await openAlexPaperService.searchPapers('computer vision', 'paper', 2)
    await openAlexPaperService.searchPapers('Geoffrey Hinton', 'author', 2)
    for (const url of urls) {
      assert.equal(url.searchParams.get('page'), '2')
      assert.equal(url.searchParams.get('per_page'), '20')
    }
    assert.equal(urls[0].searchParams.get('search'), 'computer vision')
    assert.equal(urls[1].searchParams.get('filter'), 'raw_author_name.search:"Geoffrey Hinton"')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetches one paper by ID and returns null for a missing work', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname.endsWith('/W123')) return new Response(null, { status: 404 })
    return new Response(JSON.stringify(work), { status: 200 })
  }
  try {
    assert.equal((await openAlexPaperService.getPaperById('W2741809807')).id, 'W2741809807')
    assert.equal(await openAlexPaperService.getPaperById('W123'), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})


test('includes OpenAlex response details for a 429 rate limit error', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'Rate limit exceeded',
    message: 'Anonymous search is temporarily rate-limited.',
    retryAfter: 10,
  }), { status: 429 })
  try {
    await assert.rejects(openAlexPaperService.searchPapers('computer vision'), (error) => {
      assert.match(error.message, /HTTP 429/)
      assert.match(error.message, /Error: Rate limit exceeded/)
      assert.match(error.message, /Message: Anonymous search is temporarily rate-limited/)
      assert.match(error.message, /Retry after: 10 seconds/)
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('shows a fallback message when the 429 response is not JSON', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('Too many requests', { status: 429 })
  try {
    await assert.rejects(openAlexPaperService.searchPapers('computer vision'), /Please try again later/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
