import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

const test = base.extend<{ noBrowserErrors: void }>({
  noBrowserErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await use()
    expect(errors).toEqual([])
  }, { auto: true }],
})

const paper = {
  id: 'https://openalex.org/W123',
  title: 'E2E test paper',
  authorships: [{ author: { display_name: 'Alex Researcher' } }],
  publication_year: 2025,
  publication_date: '2025-03-12',
  abstract_inverted_index: { A: [0], useful: [1], 'abstract.': [2] },
  primary_topic: { field: { display_name: 'Computer Science' } },
  keywords: [{ display_name: 'Testing' }],
  best_oa_location: { landing_page_url: 'https://papers.example.test/W123' },
}

async function mockServices(page: Page) {
  await page.route('**/src/features/auth/browserAuth.ts*', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      export const browserAuth = {
        onSessionEnded: () => () => {},
        restoreSession: async () => ({
          did: 'did:plc:e2e-reader',
          handle: 'reader.test',
          displayName: 'E2E Reader',
        }),
        getFetchHandler: () => async () => new Response(
          JSON.stringify({ error: 'RecordNotFound' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
        signIn: async () => {},
        signOut: async () => {},
      }
    `,
  }))

  await page.route('https://api.openalex.org/works**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/WFAIL')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'invalid-work-id' }) })
    }
    if (url.searchParams.get('search') === 'no matching papers') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [] }) })
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(url.pathname.endsWith('/W123') ? paper : { results: [paper] }),
    })
  })

  await page.route('https://constellation.microcosm.blue/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ total: 0 }),
  }))
}

test.beforeEach(async ({ page }) => {
  await mockServices(page)
})

test('searches for papers and displays matching results', async ({ page }) => {
  await page.goto('/search')
  await page.getByRole('searchbox', { name: 'Search query' }).fill('E2E test paper')
  await page.getByRole('button', { name: 'Search', exact: true }).click()

  await expect(page.getByRole('link', { name: paper.title })).toBeVisible()
  await expect(page.getByText('Alex Researcher')).toBeVisible()
})

test('shows an empty state when a search has no matches', async ({ page }) => {
  await page.goto('/search')
  await page.getByRole('searchbox', { name: 'Search query' }).fill('no matching papers')
  await page.getByRole('button', { name: 'Search', exact: true }).click()

  await expect(page.getByRole('status')).toHaveText('No papers found. Try a different search term.')
  await expect(page.getByRole('link', { name: paper.title })).toHaveCount(0)
})

test('combines the area with author search and clears each independently', async ({ page }) => {
  await page.goto('/search')
  const area = page.getByLabel('Research area', { exact: true })
  await area.selectOption('17')
  await expect(page.getByRole('link', { name: paper.title })).toBeVisible()
  await page.getByLabel('Search mode').selectOption('author')
  await page.getByRole('searchbox').fill('Alex')
  const request = page.waitForRequest(req => new URL(req.url()).searchParams.get('filter') === 'primary_topic.field.id:17,raw_author_name.search:"Alex"')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await request
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(area).toHaveValue('17')
  await page.route('**/works?**', route => route.fulfill({ json: { results: [] } }))
  await area.selectOption('26')
  await expect(page.getByRole('status')).toContainText('No papers match this research area')
  await page.unroute('**/works?**')
  await area.selectOption('')
  await expect(page.getByRole('link', { name: paper.title })).toBeVisible()
})

test('opens paper details from its direct URL', async ({ page }) => {
  await page.goto('/papers/W123')

  await expect(page.getByRole('heading', { level: 1, name: paper.title })).toBeVisible()
  await expect(page.getByText('A useful abstract.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Read full text' })).toHaveAttribute(
    'href',
    'https://papers.example.test/W123',
  )
})

test('shows a helpful message when paper details fail to load', async ({ page }) => {
  await page.goto('/papers/WFAIL')

  await expect(page.getByRole('alert')).toHaveText('Unable to load this paper. Please try again.')
  await expect(page.getByRole('link', { name: 'Back to Browse' })).toBeVisible()
})

test('bookmarks a paper and finds it in saved papers', async ({ page }) => {
  await page.goto('/papers/W123')
  await page.getByRole('button', { name: 'Bookmark' }).click()
  await expect(page.getByRole('button', { name: 'Bookmarked' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('link', { name: 'View saved papers' }).click()
  await expect(page.getByRole('heading', { name: 'Saved papers' })).toBeVisible()
  await expect(page.getByRole('link', { name: paper.title })).toBeVisible()
})
