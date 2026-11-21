# PaperTrail Architecture Decisions

This document summarizes the proposed technical decisions for PaperTrail's initial MVP and the reasoning behind them. These decisions are not final and may change as we refine the project scope and architecture.

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

## Backend Options

We also considered several database options in case a backend is needed later, including Turso, Neon, Supabase, and Railway Postgres. For the initial MVP, we plan to proceed without a separate database.
