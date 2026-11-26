# AT Protocol Authentication

PaperTrail uses browser OAuth for identity, likes and paper publishing. On Home, users enter a handle and authorize PaperTrail with their account provider. The provider redirects back to Home. PaperTrail shows the verified handle and, when available, the public Bluesky display name. The signed-in identity falls back to its DID if profile information is unavailable.

The browser SDK owns OAuth state, token storage and refresh, and revocation. PaperTrail uses the Bluesky resolver at `bsky.social` for AT Protocol handles and the public Bluesky API for the optional display name.

## Local development

Run `npm ci` and `npm run dev -- --host 127.0.0.1`. Open the numeric loopback URL printed by Vite, usually `http://127.0.0.1:5173/`. HTTP URLs on `localhost` redirect to `127.0.0.1` and keep the port, path, query, and fragment. The SDK uses AT Protocol loopback client metadata so the app and OAuth callback share the same origin. Local sign-in requires an AT Protocol provider that supports loopback OAuth.

## HTTPS deployment

Serve a public JSON file at `/client-metadata.json` on the deployment's HTTPS origin. Generate it from the same configuration used by loopback sign-in:

```sh
mkdir -p public
node --experimental-strip-types scripts/client-metadata.mjs https://YOUR-DEPLOYMENT.example > public/client-metadata.json
npm run build
```

Replace the example with the actual HTTPS origin. The generator rejects credentials, paths, queries and fragments. Serve the metadata as JSON without a redirect, and configure SPA fallback for the root OAuth callback and direct page requests. No deployment-specific metadata is included in the repository.

`src/features/auth/oauthConfig.ts` defines the shared scope:

```text
atproto repo:app.papertrail.like repo:app.papertrail.paper blob:application/pdf repo:app.bsky.feed.post?action=create
```

The scope grants identity access, writes to the like and paper collections, PDF blob uploads, and creation of Bluesky feed posts. It does not grant PDS bookmark or discussion writes. Users authorized before the relevant publishing or sharing permission was added must sign out and sign in again. Confirm the candidate paper collection's namespace before publishing actual research content; see [Publishing](publishing.md#record-schema-and-namespace).

See the [AT Protocol OAuth specification](https://atproto.com/specs/oauth) for metadata and redirect requirements.

## Sharing to Bluesky

From the details of an OpenAlex or community paper, choose **Share to Bluesky**, edit the text, and confirm **Post to Bluesky**. The post contains a clickable paper link. The composer shows the posting account and returns a link to the confirmed post. Local development uses the public record explorer for community uploads that lack a paper URL or DOI. Regenerate deployment metadata and renew older sessions to grant the create-only feed-post permission.

Unconfirmed shares retain their account DID, record key, timestamp, text and paper link in this tab's session storage, without credentials. After reauthorization, return to the same paper with the same account and choose **Retry post** to reuse the original record. Confirmation clears the recovery data. **Discard attempt** clears it explicitly and permits a new post, which can duplicate a post that already succeeded. Recovery requires session storage and does not extend to other tabs or devices.

## Feature integration

`AuthProvider` restores the session at app startup and exposes the current `identity`, pending operation, error, authorized `fetchHandler`, and sign-in/sign-out actions through `useAuth()`. For actions that require sign-in, wait for restoration to finish and require a non-null identity before enabling the action. Use `identity.did` as the account key. The handle is for display and can change.

Use `fetchHandler` only for relative XRPC requests to the signed-in account's PDS. The SDK manages credentials and DPoP; features must not copy tokens or forward them to another user's PDS. Public publication reads resolve the owner's PDS and omit credentials.

Bookmarks currently remain browser-local. Their migration to PDS storage and any additional permissions belong to [#34](https://github.com/Caffeinated-Coders-CSE-210/PaperTrail/issues/34).
