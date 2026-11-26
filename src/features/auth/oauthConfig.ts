import { PAPER_COLLECTION } from '../publishing/model.ts'

/** Shared by loopback sign-in and generated HTTPS deployment metadata. */
export const OAUTH_SCOPE = `atproto repo:app.papertrail.like repo:${PAPER_COLLECTION} blob:application/pdf repo:app.bsky.feed.post?action=create`
export function createClientMetadata(input: string) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Provide an HTTPS origin without a path, credentials, query or fragment.')
  const origin = url.origin
  return {
    client_id: `${origin}/client-metadata.json`, client_name: 'PaperTrail', client_uri: `${origin}/`,
    redirect_uris: [`${origin}/`], scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    token_endpoint_auth_method: 'none', application_type: 'web', dpop_bound_access_tokens: true,
  }
}
