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
| `src/features/auth/` (#4) | Auth owns the home/login page, OAuth client, callback, session restoration, and React auth state. Implement `AuthService` in `session.ts` or an adjacent adapter. Expose identity and actions through one auth hook. Agree with bookmarks on access to the authorized SDK client for PDS calls. |
| `src/features/discovery/` (#12) | Discovery owns search, cards, details, and the OpenAlex adapter. Implement `PaperService` in an adjacent module. Search returns an empty list for no matches, lookup returns `null` for a missing work, and request failures reject. Details loads by the route's `paperId` on direct entry. |
| `src/features/bookmarks/` (#8) | Bookmarks owns storage, the bookmark button, shared state, and the saved page. Implement `BookmarkStorage` for the active account. Saving a paper twice must produce one entry. Both the details button and the library consume the same state. Discovery mounts the button on the details page. |
| `src/shared/paper.ts` | Discovery and bookmarks consume the same normalized `Paper`. Use the short OpenAlex work ID across results, URLs, and storage. Build links with `paperPath(id)`. Normalize missing authors to `[]` and missing year, abstract, DOI, or link to `null`. `url` holds an available full-text or landing-page link. |

Colocate feature components, services, styles, and tests with their page. Use named exports, PascalCase component names, and feature-scoped CSS selectors. UI components can develop against typed mocks while adapters are in progress. The auth team owns the SDK session, and the storage adapter owns PDS record conversion. If the demo uses browser-local bookmarks, identify that storage choice in the UI.

## Shared files

Tom owns the initial router and shell under [#11](https://github.com/Caffeinated-Coders-CSE-210/PaperTrail/issues/11). Coordinate edits to `src/App.tsx`, `src/main.tsx`, `src/Layout.tsx`, `src/styles.css`, the shared paper model, package manifests, and Vite/TypeScript configuration. After setup merges, the integration owner wires providers at the root and verifies the demo. Feature PRs can replace their page contents without editing the route table.
