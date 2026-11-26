import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Explicit opt-in: this is a public, read-only provider check, not a CI dependency.
// Do not publish, modify or delete anything from this test.
test('reads the approved existing public PDS sample with real PDF.js', async ({ page }, testInfo) => {
  test.skip(process.env.PAPERTRAIL_LIVE_READER !== '1', 'Opt in with PAPERTRAIL_LIVE_READER=1; requires network access.')
  const did = 'did:plc:ay5jhzykb26qcvqmdochq2za'
  const key = 'ad924ddf-2ab4-45b9-b094-e16ab78d8ceb'
  const requests: string[] = []
  const errors: string[] = []
  await page.route('**/src/features/auth/browserAuth.ts*', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export const browserAuth = { onSessionEnded: () => () => {}, restoreSession: async () => null, getFetchHandler: () => { throw new Error("Public read requested credentials") } }' }))
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', request => {
    if (request.url().includes('/xrpc/')) {
      requests.push(request.url())
      expect(request.method()).toBe('GET')
      expect(request.headers()['authorization']).toBeUndefined()
      expect(request.headers()['cookie']).toBeUndefined()
    }
  })
  await page.goto(`/publications/${encodeURIComponent(did)}/${key}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PaperTrail publishing verification sample')
  await expect(page.locator('.react-pdf__Page__textContent')).toContainText('PaperTrail reader - page 1', { timeout: 25_000 })
  await expect(page.locator('.react-pdf__Page canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.locator('.react-pdf__Page[data-page-number="2"] canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.getByLabel('Zoom level')).toHaveText('125%')
  const saving = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  expect(readFileSync((await (await saving).path())!)).toEqual(readFileSync(new URL('../tests/reader/sample.pdf', import.meta.url)))
  await page.reload()
  await expect(page.locator('.react-pdf__Page canvas')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('live-publication-reader.png'), fullPage: true })
  expect(requests.some(url => url.includes('getRecord'))).toBe(true)
  expect(requests.some(url => url.includes('getBlob'))).toBe(true)
  expect(errors).toEqual([])
  await testInfo.attach('public-read-requests', { body: JSON.stringify(requests, null, 2), contentType: 'application/json' })
})
