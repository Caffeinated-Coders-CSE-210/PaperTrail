# PaperTrail Architecture Decisions

This document summarizes the technical decisions we have made so far and the approaches we are considering for upcoming features. Some decisions may change as we work on new features and learn more about what we need.


| Topic | Proposed approach | Rationale |
| --- | --- | --- |
| Frontend | React | Reusable components, mature ecosystem, community support |
| Language | TypeScript | Reduce integration errors between modules |
| Frontend tooling | Vite | Faster and simpler setup than a full-stack framework |
| Authentication | AT Protocol OAuth | Let users sign in with existing AT Protocol identities |
| AT Protocol integration | AT Protocol SDK | Avoid implementing OAuth and protocol operations manually |
| Public user records | PDS repositories and custom Lexicons | Store user-owned, app-specific records through AT Protocol |
| Paper metadata | OpenAlex | Use existing academic metadata instead of maintaining a paper database |
| Browser-side data | `localStorage` or `IndexedDB` | Keep information users do not want to publish in the browser |
| Initial backend | No separate backend or SQL database | Reduce development and deployment complexity for the MVP |
| Frontend hosting | Vercel | Straightforward deployment and hosting |
| Like counting | Constellation | Count likes across accounts without running backend or indexing firehose ourselves |


## Planned Feature Decisions

As we add more features, we plan to build on our existing AT Protocol integration where possible. The approaches below are still being discussed and may change during implementation.

| Feature | Proposed approach | Rationale |
| --- | --- | --- |
| Publish Papers | Store public paper records in users' PDS repositories using custom Lexicons | Keep published paper information under the user's AT Protocol identity |
| Cross-User Record Discovery | Investigate ways to find public records across users' PDS repositories | Allow users to discover papers and discussions shared by others |
| Reading Rooms | Store discussion posts as AT Protocol records and connect them to the related paper | Let users share notes and questions about the same paper |
| Discussion Replies | Extend Reading Room records to support replies | Allow users to respond to questions and continue discussions |
| Bookmarks in PDS | Keep private bookmarks in browser storage and use PDS records for bookmarks users choose to share | Support public sharing while keeping private bookmarks local |
| Share to Bluesky | Use the Bluesky API to share paper links and optional comments | Let users share papers through their Bluesky account |
| Direct Messaging | Investigate available messaging APIs and authentication requirements | Explore private communication without building a messaging system from scratch |

We may need additional services for cross-user record discovery, but we will first look into existing AT Protocol options before deciding whether a separate backend or indexing service is necessary.

## Backend Options

We also considered several database options in case a backend is needed later, including Turso, Neon, Supabase, and Railway Postgres. For the initial MVP, we plan to proceed without a separate database.
