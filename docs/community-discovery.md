# Public record discovery

Browse → **Browse community papers** opens `/community`. It works signed out. The catalog asks the Bluesky relay for a page of repositories containing `app.papertrail.paper`, resolves each publisher's DID to their current PDS, and reads one page of publication records using the public repository client from #37. Both relay and PDS cursors are retained for Load more. A failed publisher can be retried independently of successful results. The relay may lag repository changes or have incomplete coverage.

Each result links to the validated publication's DID and record key. The publisher shown is the repository owner. The paper authors come from its metadata. Records are merged by canonical AT URI, so different users can publish identically titled papers. Community search and research-area filtering cover the publications loaded so far, including additional pages as they arrive.

## Paper-specific records for Reading Rooms

`listPaperRecords(ref, collection, cursor?, signal?)` in `src/features/community/discovery.ts` queries Constellation for backlinks from the collection's string `subject` field. OpenAlex papers use the canonical OpenAlex work URL. Publications use their full AT URI, including the owner DID and record key. Reading Room writers should store this same string in `subject` and pass their collection to the reader. A different link field or a strong-ref object would require updating the indexed path and the PDS-side check together.

The index supplies candidates. The reader deduplicates them, fetches current records from each owner's public PDS without account credentials, verifies collection and subject, and skips deleted or retargeted records. Callers receive records with creator DID, an optional next cursor, and any failed URIs. On partial failure, retain successes and retry the same cursor. Merge pages by URI (or by creator for the list of people who liked a paper). A relay/index outage is separate from an empty result. OpenAlex details use this reader when the user selects **See who liked this paper**.

The [relay method](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/sync/listReposByCollection.json) lists repositories by collection. [Constellation](https://constellation.microcosm.blue/) indexes links by subject and source.
