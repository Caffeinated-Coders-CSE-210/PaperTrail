import assert from 'node:assert/strict'
import test from 'node:test'
import { createClientMetadata, OAUTH_SCOPE } from './oauthConfig.ts'
test('deployment metadata requests the same narrow scopes as local sign-in', () => {
  const data = createClientMetadata('https://papertrail.example.com')
  assert.equal(data.scope, OAUTH_SCOPE)
  assert.deepEqual(data.scope.split(' ').sort(), ['atproto','repo:app.papertrail.like','repo:app.papertrail.paper','blob:application/pdf'].sort())
  assert.equal(data.client_id, 'https://papertrail.example.com/client-metadata.json')
  assert.deepEqual(data.redirect_uris, ['https://papertrail.example.com/'])
})
test('refuses non-HTTPS origins and URLs containing paths, credentials or queries', () => {
  for (const origin of ['http://papertrail.example.com', 'https://user:pass@example.com', 'https://example.com/app', 'https://example.com?x=1']) assert.throws(() => createClientMetadata(origin))
})
