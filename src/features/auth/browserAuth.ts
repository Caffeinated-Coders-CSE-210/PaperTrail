import { INVALID_HANDLE } from '@atproto/syntax'
import { createAuthService } from './session'

// Likes are written as `app.papertrail.like` records. Keep in sync with public/client-metadata.json.
const OAUTH_SCOPE = 'atproto repo:app.papertrail.like'

export const browserAuth = createAuthService(
  async (onSessionDeleted) => {
    const { BrowserOAuthClient, buildLoopbackClientId } = await import('@atproto/oauth-client-browser')
    const { protocol, hostname, origin, port } = window.location
    const loopback = protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(hostname)
    const clientId = loopback
      ? `${buildLoopbackClientId({ hostname, port, pathname: '/' })}&scope=${encodeURIComponent(OAUTH_SCOPE)}`
      : new URL('/client-metadata.json', origin).href

    return BrowserOAuthClient.load({
      clientId,
      handleResolver: 'https://bsky.social',
      onSessionDeleted,
      signal: AbortSignal.timeout(8000),
    })
  },
  async (did, client) => {
    const signal = AbortSignal.timeout(4000)
    const profileUrl = new URL('/xrpc/app.bsky.actor.getProfile', 'https://public.api.bsky.app')
    profileUrl.searchParams.set('actor', did)

    const [identity, profile] = await Promise.allSettled([
      client.identityResolver.resolve(did, { signal }),
      fetch(profileUrl, { signal }).then(async (response) => {
        if (!response.ok) return null
        const data: { did?: unknown; displayName?: unknown } = await response.json()
        return data.did === did && typeof data.displayName === 'string' ? data.displayName : null
      }),
    ])

    const handle = identity.status === 'fulfilled' ? identity.value.handle : null
    return {
      handle: handle === INVALID_HANDLE ? null : handle,
      displayName: profile.status === 'fulfilled' ? profile.value : null,
    }
  },
)
