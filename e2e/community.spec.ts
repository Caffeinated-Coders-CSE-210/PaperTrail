import { expect, test } from '@playwright/test'

test('browses two publishers, retries a failed PDS and keeps equal titles distinct', async ({ page }) => {
  const a = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
  const b = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
  const collection = 'app.papertrail.paper'
  const cid = 'bafkreibjfgx2gprinfvicegelk5kosd6y2frmqpqzwqkg7usac74l3t2v4'
  let unavailable = true
  await page.route('**/src/features/auth/browserAuth.ts*', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export const browserAuth = { onSessionEnded: () => () => {}, restoreSession: async () => null }' }))
  await page.route('**/xrpc/com.atproto.sync.listReposByCollection?**', route => route.fulfill({ json: { repos: [{ did: a }, { did: b }, { did: a }] } }))
  await page.route('https://plc.directory/**', route => {
    const id = new URL(route.request().url()).pathname.slice(1)
    return route.fulfill({ json: { id, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer',
      serviceEndpoint: id === a ? 'https://a.example' : 'https://b.example' }] } })
  })
  await page.route('**/xrpc/com.atproto.repo.listRecords?**', route => {
    const url = new URL(route.request().url())
    const did = url.searchParams.get('repo')
    if (did === b && unavailable) return route.fulfill({ status: 503, json: {} })
    const value = { $type: collection, title: 'Shared title', authors: ['Ada'], researchArea: did === a ? 'Robotics' : 'Medicine',
      createdAt: '2026-11-23T00:00:00Z', pdf: { $type: 'blob', ref: { $link: cid }, mimeType: 'application/pdf', size: 24 } }
    const record = { uri: `at://${did}/${collection}/same-key`, cid, value }
    return route.fulfill({ json: { records: [record, record] } })
  })
  await page.goto('/community')
  await expect(page.getByRole('link', { name: 'Shared title' })).toHaveCount(1)
  unavailable = false
  await page.getByRole('button', { name: 'Retry failed request' }).click()
  await expect(page.getByRole('link', { name: 'Shared title' })).toHaveCount(2)
  await page.getByLabel('Research area').selectOption('Medicine')
  await expect(page.getByRole('link', { name: 'Shared title' })).toHaveAttribute('href', '/publications/' + encodeURIComponent(b) + '/same-key')
  await expect(page.getByText('Published by ' + b)).toBeVisible()
})
