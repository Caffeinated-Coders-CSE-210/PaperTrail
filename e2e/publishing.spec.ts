import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { cidForRawBytes } from '@atproto/lex-data'

const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const bytes = readFileSync(new URL('../tests/reader/sample.pdf', import.meta.url))
const pdfCid = (await cidForRawBytes(bytes)).toString()
const blob = { $type: 'blob', ref: { $link: pdfCid }, mimeType: 'application/pdf', size: bytes.length }
const collection = 'app.papertrail.paper'

test('publishes a fixed PDF, recovers a lost write response, reloads public details and verifies PDF bytes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const records = new Map<string, { uri: string; cid: string; value: unknown }>()
  let uploads = 0; let creates = 0
  await page.route('**/src/features/auth/browserAuth.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    const handler = (path, init) => fetch('https://pds.papertrail.test' + path, init);
    export const browserAuth = {
      onSessionEnded: () => () => {}, restoreSession: async () => ({ did: '${did}', handle: 'test.example' }),
      getFetchHandler: () => handler, signIn: async () => {}, signOut: async () => {},
    };
  ` }))
  await page.route(`https://plc.directory/${did}`, route => route.fulfill({ json: { id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.papertrail.test' }] } }))
  await page.route('https://pds.papertrail.test/**', async route => {
    const request = route.request(); const url = new URL(request.url())
    if (url.pathname.endsWith('describeServer')) return route.fulfill({ json: { blobUploadLimit: 5242880 } })
    if (url.pathname.endsWith('uploadBlob')) {
      uploads++
      expect(request.headers()['content-type']).toBe('application/pdf')
      expect(request.postDataBuffer()).toEqual(bytes)
      return route.fulfill({ json: { blob } })
    }
    if (url.pathname.endsWith('createRecord')) {
      creates++; const data = request.postDataJSON()
      expect(data.repo).toBe(did); expect(data.collection).toBe(collection)
      records.set(data.rkey, { uri: `at://${did}/${collection}/${data.rkey}`, cid: pdfCid, value: data.record })
      // The server committed but its response did not reach the client.
      return route.abort('failed')
    }
    if (url.pathname.endsWith('getRecord')) {
      const record = records.get(url.searchParams.get('rkey')!)
      return route.fulfill(record ? { json: record } : { status: 400, json: { error: 'RecordNotFound' } })
    }
    if (url.pathname.endsWith('listRecords')) return route.fulfill({ json: { records: [...records.values()] } })
    if (url.pathname.endsWith('getBlob')) {
      // Interception bypasses wire decoding. Model Fetch's decoded body and encoded length.
      const transferLength = gzipSync(bytes).length
      return route.fulfill({ headers: { 'Content-Type': 'application/pdf', 'Content-Encoding': 'gzip', 'Content-Length': String(transferLength) }, body: bytes })
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  })
  await page.goto('/publish')
  await page.getByLabel('Title', { exact: true }).fill('Browser publishing sample')
  await page.getByLabel('Authors (one per line)').fill('PaperTrail Test Author')
  await page.getByLabel('Abstract', { exact: true }).fill('A fixed sample for publishing checks.')
  await page.getByLabel('PDF file (up to 5 MiB)').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: bytes })
  await page.getByRole('button', { name: 'Review publication', exact: true }).click()
  await expect(page.getByText('Your metadata and PDF will be public and may be copied by others.')).toBeVisible()
  await expect(page.getByText('A fixed sample for publishing checks.', { exact: true })).toBeVisible()
  expect(creates).toBe(0)
  await page.getByRole('button', { name: 'Publish publicly', exact: true }).click()
  await page.getByRole('link', { name: 'View publication', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Browser publishing sample' })).toBeVisible()
  const directUrl = page.url()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Browser publishing sample' })).toBeVisible()
  await page.getByRole('button', { name: 'Check PDF availability' }).click()
  await expect(page.getByRole('status')).toContainText('PDF retrieved and verified')
  expect(uploads).toBe(1); expect(creates).toBe(1)
  await page.getByRole('navigation').getByRole('link', { name: 'My publications' }).click()
  await expect(page.getByRole('link', { name: 'Browser publishing sample' })).toHaveAttribute('href', new URL(directUrl).pathname)
  await page.reload()
  await expect(page.getByRole('link', { name: 'Browser publishing sample' })).toBeVisible()
  expect(errors).toEqual([])
})

test('signed-out publishing is protected and missing public metadata does not use OpenAlex', async ({ page }) => {
  let openAlexRequests = 0
  await page.route('**/src/features/auth/browserAuth.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `export const browserAuth = { onSessionEnded: () => () => {}, restoreSession: async () => null, getFetchHandler: () => null };` }))
  await page.route('https://api.openalex.org/**', route => { openAlexRequests++; return route.abort() })
  await page.route(`https://plc.directory/${did}`, route => route.fulfill({ json: { id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.papertrail.test' }] } }))
  await page.route('https://pds.papertrail.test/**', route => route.fulfill({ status: 400, json: { error: 'RecordNotFound' } }))
  await page.goto('/publish')
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review publication' })).toHaveCount(0)
  await page.goto(`/publications/${encodeURIComponent(did)}/missing-paper`)
  await expect(page.getByText('Publication not found.')).toBeVisible()
  expect(openAlexRequests).toBe(0)
})
