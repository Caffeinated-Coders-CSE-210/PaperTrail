import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { cidForRawBytes } from '@atproto/lex-data'

const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const bytes = readFileSync(new URL('../tests/reader/sample.pdf', import.meta.url))
const cid = (await cidForRawBytes(bytes)).toString()
const path = (key = 'sample') => `/publications/${encodeURIComponent(did)}/${key}`
const record = (key = 'sample') => ({
  uri: `at://${did}/app.papertrail.paper/${key}`, cid,
  value: { $type: 'app.papertrail.paper', title: key === 'sample' ? 'Uploaded reader sample' : 'Second uploaded paper',
    authors: ['Test Author'], abstract: 'Verified public metadata.', keywords: ['Reader', 'Testing'], researchArea: 'Software Engineering',
    year: 2026, createdAt: '2026-11-24T00:17:11.907Z',
    pdf: { $type: 'blob', ref: { $link: cid }, mimeType: 'application/pdf', size: bytes.length } },
})

async function mockPds(page: Page) {
  await page.route('**/src/features/auth/browserAuth.ts*', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export const browserAuth = { onSessionEnded: () => () => {}, restoreSession: async () => null, getFetchHandler: () => { throw new Error("Public reading requested credentials") } }' }))
  await page.route('**/xrpc/com.atproto.sync.listReposByCollection?**', route => route.fulfill({ json: { repos: [{ did }] } }))
  await page.route(`https://plc.directory/${did}`, route => {
    expect(route.request().headers()['authorization']).toBeUndefined()
    return route.fulfill({ json: { id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.reader.test' }] } })
  })
  await page.route('https://pds.reader.test/**', route => {
    const request = route.request()
    expect(request.method()).toBe('GET')
    expect(request.headers()['authorization']).toBeUndefined()
    expect(request.headers()['cookie']).toBeUndefined()
    const url = new URL(request.url())
    if (url.pathname.endsWith('listRecords')) return route.fulfill({ json: { records: [record(), record('second')] } })
    if (url.pathname.endsWith('getRecord')) return route.fulfill({ json: record(url.searchParams.get('rkey')!) })
    expect(url.pathname).toBe('/xrpc/com.atproto.sync.getBlob')
    expect(url.searchParams.get('did')).toBe(did)
    expect(url.searchParams.get('cid')).toBe(cid)
    return route.fulfill({ contentType: 'application/pdf', body: bytes })
  })
}

async function rendered(page: Page, number = 1) {
  const canvas = page.locator(`.react-pdf__Page[data-page-number="${number}"] canvas`)
  await expect(canvas).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled()
  // A canvas element alone can exist before PDF.js finishes painting it.
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('2d')!
    const pixels = context.getImageData(0, 0, element.width, element.height).data
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && pixels[i] < 150 && pixels[i + 1] < 150 && pixels[i + 2] < 150) return true
    }
    return false
  })).toBe(true)
}

test('anonymous community reading renders with the actual PDF.js worker, navigates, zooms, downloads and reloads', async ({ page }, testInfo) => {
  await mockPds(page)
  const errors: string[] = []
  const workers: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('worker', worker => workers.push(worker.url()))
  await page.goto('/community')
  await page.getByRole('link', { name: 'Uploaded reader sample' }).click()
  await expect(page).toHaveURL(new RegExp('/publications/'))
  await expect(page.getByText('Test Author', { exact: true })).toBeVisible()
  await expect(page.getByText('Verified public metadata.')).toBeVisible()
  await expect(page.getByText('Software Engineering', { exact: true })).toBeVisible()
  await expect(page.getByText('Reader, Testing')).toBeVisible()
  await rendered(page)
  expect(workers.some(url => url.includes('pdf.worker'))).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('uploaded-reader.png'), fullPage: true })
  await page.getByRole('button', { name: 'Next page' }).click()
  await rendered(page, 2)
  await page.getByRole('textbox', { name: 'Page number' }).fill('99')
  await page.getByRole('textbox', { name: 'Page number' }).press('Enter')
  await expect(page.getByRole('alert')).toContainText('between 1 and 3')
  await page.getByRole('textbox', { name: 'Page number' }).fill('3')
  await page.getByRole('textbox', { name: 'Page number' }).press('Enter')
  await rendered(page, 3)
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled()
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.getByLabel('Zoom level')).toHaveText('200%')
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom out' }).click()
  await expect(page.getByLabel('Zoom level')).toHaveText('50%')
  await page.getByRole('button', { name: 'Fit width' }).click()
  await expect(page.getByLabel('Zoom level')).toHaveText('100%')
  const saving = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  const download = await saving
  expect(download.suggestedFilename()).toBe('Uploaded reader sample.pdf')
  const saved = await download.path()
  expect(readFileSync(saved!)).toEqual(bytes)
  await page.reload()
  await rendered(page)
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('1')
  await page.getByRole('link', { name: 'Back to community papers' }).click()
  await expect(page).toHaveURL(/\/community$/)
  await expect(page.getByRole('link', { name: 'Uploaded reader sample' })).toBeVisible()
  await page.goto(path())
  await rendered(page)
  expect(errors).toEqual([])
})

test('PDF failures preserve metadata and retry retrieval without reloading metadata', async ({ page }) => {
  await mockPds(page)
  let failed = true
  let metadataReads = 0
  page.on('request', request => { if (request.url().includes('getRecord')) metadataReads++ })
  await page.route('**/xrpc/com.atproto.sync.getBlob?**', route => failed
    ? route.fulfill({ status: 404, json: { error: 'BlobNotFound' } })
    : route.fulfill({ contentType: 'application/pdf', body: bytes }))
  await page.goto(path())
  await expect(page.getByRole('alert')).toContainText('unavailable')
  await expect(page.getByText('Verified public metadata.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to community papers' })).toBeVisible()
  const before = metadataReads
  failed = false
  await page.getByRole('button', { name: 'Retry PDF' }).click()
  await rendered(page)
  // The PDF service revalidates the record; the metadata view is not fetched again.
  expect(metadataReads).toBe(before + 1)
})

test('leaving a stalled PDF for another publication never restores the old reader', async ({ page }) => {
  await mockPds(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const pending = new Promise<void>(resolve => { started = resolve })
  let first = true
  await page.route('**/xrpc/com.atproto.sync.getBlob?**', async route => {
    if (first) { first = false; started(); await held }
    await route.fulfill({ contentType: 'application/pdf', body: bytes }).catch(() => {})
  })
  await page.goto(path())
  await pending
  await page.getByRole('link', { name: 'Back to community papers' }).click()
  await page.getByRole('link', { name: 'Second uploaded paper' }).click()
  await rendered(page)
  release()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Second uploaded paper')
  await expect(page.getByRole('region', { name: 'PDF reader: Uploaded reader sample', exact: true })).toHaveCount(0)
})

test('OpenAlex URL input still renders and downloads through the same reader', async ({ page }) => {
  await mockPds(page)
  await page.route('https://api.openalex.org/works/W123', route => route.fulfill({ json: {
    id: 'https://openalex.org/W123', title: 'OpenAlex reader sample',
    best_oa_location: { pdf_url: 'https://pdf.reader.test/sample.pdf', landing_page_url: 'https://paper.reader.test' },
  } }))
  await page.route('https://constellation.microcosm.blue/**', route => route.fulfill({ json: { total: 0 } }))
  await page.route('https://pdf.reader.test/sample.pdf', route => route.fulfill({ contentType: 'application/pdf', body: bytes }))
  await page.goto('/papers/W123')
  await rendered(page)
  await expect(page.getByRole('link', { name: 'Open source PDF' })).toHaveAttribute('href', 'https://pdf.reader.test/sample.pdf')
  await page.getByRole('button', { name: 'Next page' }).click()
  await rendered(page, 2)
  const saving = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  expect(readFileSync((await (await saving).path())!)).toEqual(bytes)
})

test('a verified but unparseable PDF can be retrieved again and rendered on retry', async ({ page }) => {
  await mockPds(page)
  // Pass the service's header/CID checks, then exercise PDF.js parse failure.
  const broken = Buffer.concat([Buffer.from('%PDF-1.4\n'), readFileSync(new URL('../tests/reader/broken.pdf', import.meta.url))])
  const brokenCid = (await cidForRawBytes(broken)).toString()
  let repaired = false
  await page.route('**/xrpc/com.atproto.repo.getRecord?**', route => {
    const row = record()
    if (!repaired) row.value.pdf = { ...row.value.pdf, ref: { $link: brokenCid }, size: broken.length }
    return route.fulfill({ json: row })
  })
  await page.route('**/xrpc/com.atproto.sync.getBlob?**', route => route.fulfill({ contentType: 'application/pdf', body: repaired ? bytes : broken }))
  await page.goto(path())
  await expect(page.getByRole('alert')).toContainText('Unable to load this PDF')
  await expect(page.getByText('Verified public metadata.')).toBeVisible()
  repaired = true
  await page.getByRole('button', { name: 'Retry PDF' }).click()
  await rendered(page)
})

test('PDF retry preserves a publication Bluesky attempt and refresh restores the same post', async ({ page }) => {
  await mockPds(page)
  await page.route('**/src/features/auth/browserAuth.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export const browserAuth = { onSessionEnded: () => () => {}, restoreSession: async () => ({ did: '${did}', handle: 'reader.test' }),
      getFetchHandler: () => (path, init) => fetch('https://pds.share.test' + path, init) }
  ` }))
  let unavailable = true
  await page.route('**/xrpc/com.atproto.sync.getBlob?**', route => unavailable
    ? route.fulfill({ status: 404, json: { error: 'BlobNotFound' } })
    : route.fulfill({ contentType: 'application/pdf', body: bytes }))
  let original: unknown
  let creates = 0
  await page.route('https://pds.share.test/**', route => {
    const data = route.request().postDataJSON()
    creates++
    if (creates === 1) {
      original = data
      return route.fulfill({ status: 403, json: { error: 'InsufficientScope' } })
    }
    expect(data).toEqual(original)
    expect(data.record.text).toBe('Keep this publication comment\n\nRead paper')
    expect(data.record.facets[0].features[0].uri).toBe(`https://pdsls.dev/at://${did}/app.papertrail.paper/sample`)
    return route.fulfill({ json: { uri: `at://${did}/app.bsky.feed.post/${data.rkey}`, cid } })
  })
  await page.goto(path())
  await expect(page.getByRole('alert')).toContainText('unavailable')
  await page.getByRole('button', { name: 'Share to Bluesky' }).click()
  await page.getByLabel('Post text').fill('Keep this publication comment')
  await page.getByRole('button', { name: 'Post to Bluesky' }).click()
  await expect(page.getByText(/Posting was denied/)).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Retry PDF' }).click()
  await rendered(page)
  await expect(page.getByLabel('Post text')).toHaveValue('Keep this publication comment')
  await expect(page.getByLabel('Post text')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Retry post' })).toBeVisible()
  await page.reload()
  await rendered(page)
  await expect(page.getByLabel('Post text')).toHaveValue('Keep this publication comment')
  await page.getByRole('button', { name: 'Retry post' }).click()
  await expect(page.getByRole('link', { name: 'View post' })).toBeVisible()
  expect(creates).toBe(2)
})
