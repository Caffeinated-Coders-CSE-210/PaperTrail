# Publishing papers and PDS repository integration

PaperTrail publishes paper metadata and PDFs to the signed-in account's PDS. This feature implements [#37](https://github.com/Caffeinated-Coders-CSE-210/PaperTrail/issues/37) and provides repository operations for later features.

## Scope

Authenticated users can select a PDF, enter metadata, review public visibility, and publish a record referencing the PDF in their PDS. My publications reads the current account's records with cursor pagination. Publication details load metadata from a stable URL and automatically retrieve the verified PDF for the shared reader. PDF failures preserve available metadata and provide an independent retry.

Uploaded-paper reading is implemented by [#15](https://github.com/Caffeinated-Coders-CSE-210/PaperTrail/issues/15), using the publishing/retrieval contract from #37 (which supersedes the old #1 dependency). Community discovery from #30 is available at `/community`; see [Public record discovery](community-discovery.md). Public bookmark storage remains #34, Reading Room posts #31, and publication management UI #10. #3 is closed. Issue acceptance and closure are separate from this implementation.

## Metadata and identity

`src/shared/paper.ts` defines common `PaperMetadata` fields. The existing OpenAlex `Paper`, `PaperId = W${number}`, `paperPath(id)`, and `/papers/:paperId` remain compatible.

New code uses a source discriminator:

```ts
type PaperRef =
  | { source: 'openalex'; id: PaperId }
  | { source: 'publication'; repoDid: string; rkey: string }
```

Publication details use `/publications/:repoDid/:rkey`, with each parameter encoded separately. A publication's canonical identity is `at://<DID>/<collection>/<rkey>`. The record CID describes its content version; the PDF CID describes the file. Neither CID replaces the stable publication identifier.

Direct entry resolves the owner's DID document, locates its current PDS, retrieves the record and validates it. It does not depend on navigation state, local bookmarks, or OpenAlex. Public requests omit credentials. Authorized writes use the active account's OAuth `fetchHandler` and relative XRPC paths.

The application normalizes absent scalar metadata to `null` and absent keyword lists to `[]`. Optional null metadata is omitted from the protocol record. The paper page `url` is separate from the PDF source and is never substituted for a missing PDF.

## Record schema and namespace

`lexicons/app.papertrail.paper.json` defines the candidate `app.papertrail.paper` record schema. This follows the existing likes naming pattern, but domain authority and network schema publication have not been confirmed. A checked-in schema does not establish ownership of `papertrail.app` or prove that a PDS validates this custom schema. Confirm the collection before publishing actual research content; changing a deployed collection would change canonical record identities.

The record contains title, authors, optional metadata, `createdAt`, and a required `pdf` blob reference. Publisher identity comes from the repository URI, separately from the paper's authors. `createdAt` is the publishing timestamp, not the paper's publication date. Its calendar date is checked in addition to protocol datetime syntax. Author order and repeated display names are preserved; only keywords are deduplicated.

| Field | Local validation |
| --- | --- |
| Title | Required; at most 1,000 UTF-8 bytes |
| Authors | At least one nonempty name; at most 50 names, 300 bytes each |
| Abstract | Optional; at most 20,000 bytes |
| Research area | Optional; at most 300 bytes |
| Keywords | At most 30 entries, 100 bytes each; trimmed and deduplicated |
| Year | Optional integer from 1 to 9,999 |
| Publication date | Optional valid `YYYY-MM-DD`; consistent with year when both exist |
| DOI | Optional normalized DOI; at most 500 bytes |
| Paper page URL | Optional HTTP/HTTPS URL without embedded credentials; at most 2,000 bytes |
| PDF | Required blob with PDF MIME, valid raw SHA-256 CID, positive size, and product size limit |

The locked `@atproto/lexicon` validator checks blob shape but does not enforce its `accept` or `maxSize` constraints. Application validation therefore enforces PDF MIME, size and content identity at upload and retrieval boundaries. Tests exercise the formal schema and the additional application checks separately.

## PDF storage and retrieval

The product limit is 5 MiB (5,242,880 bytes). Upload uses the smaller of this limit and `describeServer.blobUploadLimit`, if advertised. An absent server limit is not an unlimited-storage guarantee. File checks include extension, nonempty size, browser MIME when present, and `%PDF-` header. They do not guarantee that every PDF is parseable or safe.

`uploadPdf` sends raw bytes with `Content-Type: application/pdf`, using the existing OAuth handler. The browser manages Content-Length. The returned blob reference must match the selected file's size, MIME and content CID.

Records store the complete blob object, including `$type`, CID link, MIME and size. They do not store object URLs, tokens or the PDS hostname. Upload precedes the record write. Unreferenced uploads remain temporary and can be garbage collected; a successful file upload is not a successful publication. See the [official blob lifecycle](https://atproto.com/specs/blob#blob-lifecycle).

`getPublicationPdf(ref, { signal })` returns `Promise<Blob>` containing verified PDF bytes. It loads the current record, fetches the blob using its owner's current PDS, bounds the response size and checks MIME, header, declared size and SHA-256 CID. Metadata and PDF errors remain separate. Size and CID checks use the decoded PDF bytes; Content-Length may describe a compressed transfer and is not compared with the record size.

The returned Blob is an in-memory result, not a persistent URL. The service does not create object URLs. `PdfReader` accepts either the existing `pdfUrl: string | null` or `pdfBlob: Blob`, never both. URL inputs still allow only HTTP/HTTPS. Publication details pass the verified Blob directly to React-PDF 11.1.0, whose locked source supports Blob inputs; the paper-page URL is never used as a PDF source. No reading object URL is created.

The publication page owns retrieval, its AbortController and a 30-second retrieval timeout. It retains one stable Blob for the successful attempt. A keyed details subtree resets immediately when DID or record key changes; cleanup aborts metadata/PDF requests and late responses are ignored. PDF errors and retries do not reset metadata or the Bluesky sharing/recovery component. PDF retries retrieve and verify the current record/blob again, including after a renderer error.

The reader keeps the input stable across page/zoom updates. A source change starts a fresh reader session at page 1 and 100% zoom. A standalone Blob retry uses a new immutable Blob view, so React-PDF does not reuse a failed resource. React-PDF owns FileReader conversion, PDF.js loading tasks and worker buffers; unmount releases its resources. The page drops its Blob reference on retry/unmount. PDF.js uses the legacy main library and matching legacy worker configured in Vite and the reader; these compatibility paths must remain paired for Safari 18.3.

Downloads continue to call the loaded PDF.js document's `getData()`, including for Blob inputs, without a second file request. The reader owns the temporary download URL and revokes it after 30 seconds or on session cleanup; an asynchronous stale download cannot save after switching papers. Blob failures offer retry without inventing an external PDF URL. Paper-page links and the existing Bluesky sharing flow remain separate from PDF delivery.

The [official blob specification](https://atproto.com/specs/blob#security-considerations) requires an independent distribution service for browser assets and does not guarantee direct browser serving from a PDS. The direct byte-fetch adapter is a capability under evaluation, not a general PDS compatibility claim. A successful fetch on one provider does not establish protocol-wide browser delivery support. No CDN or proxy is introduced by this branch; any required distribution infrastructure needs a separate scope decision.

Public records and PDFs can be copied. Account restrictions, content removal or hosting failures can make a PDF unavailable later. Deleting a record cannot recall copies already made by other parties.

## Service boundaries

| Module | Responsibility |
| --- | --- |
| `features/repository/client.ts` | Bound-account create/get/list/put/delete; validated record identities, pagination, protocol errors, optional compare-and-swap conditions, and public DID/PDS resolution |
| `features/publishing/model.ts` | Shared metadata normalization, publication identity, record conversion and PDF reference validation |
| `features/publishing/pdf.ts` | File validation, authorized raw upload and bounded public byte retrieval |
| `features/publishing/service.ts` | Account-bound publishing attempts, recovery, publication pages, public metadata/PDF access |
| Publishing pages | Form, confirmation, status/retry, own-publication list and metadata details |

`listRecords` returns one page and an optional cursor. It does not load every record implicitly. My publications preserves previously loaded entries on a next-page failure and retries the failed cursor. Ordering follows PDS pagination; it is not a global chronological feed.

`getRecord` returns `null` only for the specific RecordNotFound response. Other failures reject. Invalid list items reject the page instead of being silently dropped. API errors retain a category, HTTP status and protocol code. Authentication failures, explicit insufficient scope, general forbidden operations, rate limits, size rejection, conflicts, invalid data and network failures remain distinguishable. Browser network failures do not prove CORS is the cause. JSON bodies are bounded before parsing: 1 MiB for individual responses, 8 MiB for record pages, and 16 KiB for HTTP errors. These limits count decoded bytes and cancel oversized streams.

The reusable client does not migrate likes or private local bookmarks. Publication details do not mount their current OpenAlex-specific controls. Future consumers must use source-aware references rather than interpreting an AT URI as an OpenAlex ID.

## Publishing and retry behavior

A prepared attempt fixes the account DID, metadata snapshot, generated UUID record key, createdAt and selected file. Concurrent calls share the same in-flight operation. Before writing, the attempt checks its reserved key. It uploads only if needed and creates a record rather than overwriting one.

If a response is lost after a write, the attempt queries the same key and compares the publication's metadata, createdAt and blob. A matching record confirms success. A different record is a conflict. If no record can be confirmed, the UI reports an unconfirmed publication and retains the attempt for retry.

An explicit missing/invalid temporary blob error clears the upload reference so a later retry reuploads with the same record key. Invalidation still runs if the recovery lookup fails or is cancelled. Other failures retain the existing reference. There is no placeholder record or assumed client-side temporary-blob deletion endpoint.

Before submission, the user can return from review to edit. After submission starts, the confirmed snapshot stays fixed during retries. Refreshing does not restore an unpublished File or attempt; users should inspect My publications before starting again. Distinct publishing attempts are not deduplicated by DOI, title or PDF content.

Account-bound pages reset on authentication transitions. Requests are cancelled on unmount, and the service checks that the publishing account is still active between operations. An already dispatched write can still commit; cancellation is not a remote rollback.

## Authentication and deployment

Publishing uses the authorized `fetchHandler` exposed by `useAuth()`. See [Authentication](authentication.md) for the shared scope, renewed authorization and HTTPS metadata generation. Deployment must serve the SPA at publication detail URLs as well as the OAuth callback.

## Tests and reader handoff

Node service tests and Vitest component tests live beside the publishing and repository modules. `e2e/publishing.spec.ts` uses a fixed PDF from `tests/reader/sample.pdf` and mock authentication/PDS requests to cover publication, lost-response recovery, list retrieval, details refresh and PDF byte verification. These tests do not establish real-provider compatibility. Run the checks described in the [README](../README.md#end-to-end-tests) and record real-account observations separately in the PR.

Community results link to the stable publication route and the shared reader. Direct access and refresh resolve the owner from the URL without navigation state or sign-in. Publication details always offer **Back to community papers** and **My publications**; OpenAlex details retain their own Browse route. Metadata includes authors, abstract, research area, keywords and optional DOI/date/page links.

Formal namespace authority/schema publication and production browser file distribution remain open. A small approved PDF was published and retrieved successfully in Chrome against one Bluesky-hosted PDS; this does not establish support for other providers, Safari, near-limit uploads or deployed HTTPS origins.
