import { expect, test } from '@playwright/test'

test('edits a paper post, handles missing scope and shows the confirmed Bluesky link', async ({ page }) => {
  const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
  const url = 'https://openalex.org/W7'
  let posts = 0
  let postUrl = ''
  await page.route('**/src/features/auth/browserAuth.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export const browserAuth = { onSessionEnded: () => () => {}, restoreSession: async () => ({ did: '${did}', handle: 'reader.test' }),
      getFetchHandler: () => (path, init) => fetch('https://pds.test' + path, init) }` }))
  await page.route('https://api.openalex.org/works/W7', route => route.fulfill({ json: { id: url, title: 'Shared research' } }))
  await page.route('https://constellation.microcosm.blue/**', route => route.fulfill({ json: { total: 0 } }))
  await page.route('https://pds.test/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 400, json: { error: 'RecordNotFound' } })
    const data = route.request().postDataJSON()
    posts++
    if (posts === 1) return route.fulfill({ status: 403, json: { error: 'InsufficientScope' } })
    expect(data.repo).toBe(did)
    expect(data.collection).toBe('app.bsky.feed.post')
    expect(data.record.text).toBe('值得一读 🧠\n\nRead paper')
    expect(data.record.facets[0].features[0].uri).toBe(url)
    postUrl = `https://bsky.app/profile/${did}/post/${data.rkey}`
    return route.fulfill({ json: { uri: `at://${did}/${data.collection}/${data.rkey}`,
      cid: 'bafkreibjfgx2gprinfvicegelk5kosd6y2frmqpqzwqkg7usac74l3t2v4' } })
  })
  await page.goto('/papers/W7')
  await page.getByRole('button', { name: 'Share to Bluesky' }).click()
  await page.getByLabel('Post text').fill('值得一读 🧠')
  expect(posts).toBe(0)
  await page.getByRole('button', { name: 'Post to Bluesky' }).click()
  await expect(page.getByRole('alert')).toContainText('Posting was denied')
  await page.getByRole('button', { name: 'Post to Bluesky' }).click()
  await expect(page.getByRole('link', { name: 'View post' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View post' })).toHaveAttribute('href', postUrl)
  expect(posts).toBe(2)
})
