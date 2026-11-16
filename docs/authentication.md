# AT Protocol Authentication

PaperTrail uses browser OAuth with the `atproto` scope. On Home, users enter a handle and authorize PaperTrail with their account provider. The provider redirects back to Home. PaperTrail shows the verified handle and, when available, the public Bluesky display name. The signed-in identity falls back to its DID if profile information is unavailable.

The browser SDK owns OAuth state, token storage and refresh, and revocation. PaperTrail uses the Bluesky resolver at `bsky.social` for AT Protocol handles and the public Bluesky API for the optional display name.

## Local development

Run `npm ci` and `npm run dev -- --host 127.0.0.1`. Open the numeric loopback URL printed by Vite, usually `http://127.0.0.1:5173/`. HTTP URLs on `localhost` redirect to `127.0.0.1` and keep the port, path, query, and fragment. The SDK uses AT Protocol loopback client metadata so the app and OAuth callback share the same origin. Local sign-in requires an AT Protocol provider that supports loopback OAuth.

## HTTPS deployment

Serve a public JSON file at `/client-metadata.json` on the deployment's HTTPS origin. For a Vite deployment, place the file in `public/client-metadata.json` before building. Use the actual deployment origin in all three URLs below. The metadata URL must serve JSON without a redirect, and the app's root URL must serve the SPA for the OAuth callback.

```json
{
  "client_id": "https://papertrail.example.com/client-metadata.json",
  "client_name": "PaperTrail",
  "client_uri": "https://papertrail.example.com/",
  "redirect_uris": ["https://papertrail.example.com/"],
  "scope": "atproto",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "application_type": "web",
  "dpop_bound_access_tokens": true
}
```

See the [AT Protocol OAuth specification](https://atproto.com/specs/oauth) for metadata and redirect requirements.

## Feature integration

`AuthProvider` restores the session at app startup and exposes the current `identity`, pending operation, error, and sign-in/sign-out actions through `useAuth()`. For actions that require sign-in, wait for restoration to finish and require a non-null identity before enabling the action. Use `identity.did` as the account key. The handle is for display and can change.

The current OAuth scope covers identity. If bookmarks use the account's PDS, coordinate the saved-paper Lexicon, write scope, and authorized SDK session with the auth team as part of [#8](https://github.com/Caffeinated-Coders-CSE-210/PaperTrail/issues/8).
