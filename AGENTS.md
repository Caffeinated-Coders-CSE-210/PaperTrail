# Developing PaperTrail

PaperTrail is a frontend-only research notebook built with React, TypeScript, and Vite. The first demo connects AT Protocol sign-in, OpenAlex discovery, and a saved-paper library. See [the architecture](docs/architecture.md) for the planned data flow and [the contributor guide](docs/CONTRIBUTING.md) for the PR workflow.

## Commands

- `npm ci` installs the locked dependencies.
- `npm run dev` starts the local app.
- `npm run typecheck` checks TypeScript.
- `npm run build` checks TypeScript and builds the production site. Use `npm run preview` to exercise that build.

## Ownership and interfaces

| Area | Owner and handoff |
| --- | --- |
| `src/features/auth/` (#4) | Auth owns the home/login page, OAuth client, callback, session restoration, and React auth state. Implement `AuthService` in `session.ts` or an adjacent adapter. Expose identity and actions through one auth hook. Expose the authorized `fetchHandler` through `useAuth()` for current-account PDS writes; do not forward account credentials to other PDSs. |
| `src/features/discovery/` (#12) | Discovery owns search, cards, details, and the OpenAlex adapter. Implement `PaperService` in an adjacent module. Search returns an empty list for no matches, lookup returns `null` for a missing work, and request failures reject. Details loads by the route's `paperId` on direct entry. |
| `src/features/bookmarks/` (#8) | Bookmarks owns storage, the bookmark button, shared state, and the saved page. Implement `BookmarkStorage` for the active account. Saving a paper twice must produce one entry. Both the details button and the library consume the same state. Discovery mounts the button on the details page. |
| `src/features/publishing/` (#37) | Publishing owns the form, My publications, publication metadata details, paper record conversion, PDF upload/retrieval and publish recovery. Keep full reader integration in #15 and global discovery in #30. See [Publishing](docs/publishing.md). |
| `src/features/repository/` | Thin account-bound PDS CRUD, pagination, protocol errors and public DID/PDS resolution. Reuse without requiring unrelated features to migrate. |
| `src/shared/paper.ts` | Share `PaperMetadata` fields. Existing discovery and bookmarks retain `Paper`, short OpenAlex `PaperId` and `paperPath(id)`. New publication references carry source, DID and record key; use `publicationPath(ref)` from the publishing model. Never cast AT URIs/CIDs to OpenAlex IDs. Normalize missing metadata consistently; `url` is a paper-page link, separate from a PDF source. |

Colocate feature components, services, styles, and tests with their page. Use named exports, PascalCase component names, and feature-scoped CSS selectors. UI components can develop against typed mocks while adapters are in progress. The auth team owns the SDK session, and the storage adapter owns PDS record conversion. If the demo uses browser-local bookmarks, identify that storage choice in the UI.

## Shared files

Tom owns the initial router and shell under [#11](https://github.com/Caffeinated-Coders-CSE-210/PaperTrail/issues/11). Coordinate edits to `src/App.tsx`, `src/main.tsx`, `src/Layout.tsx`, `src/styles.css`, the shared paper model, package manifests, and Vite/TypeScript configuration. After setup merges, the integration owner wires providers at the root and verifies the demo. Feature PRs can replace their page contents without editing the route table.
