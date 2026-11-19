# OpenAlex API

PaperTrail uses [OpenAlex](https://openalex.org/) to find papers and get their metadata. The API code is in `src/features/discovery/openalex.ts`. It converts OpenAlex responses into our shared `Paper` type (`src/shared/paper.ts`), so the search page and paper details page can work with the same format.

## Search and Paper Lookup

The `openAlexPaperService` follows the `PaperService` interface in `src/features/discovery/service.ts`.

| Method | OpenAlex request | What it does |
| --- | --- | --- |
| `listDefaultPapers(page = 1)` | `GET /works?page=<page>&per_page=20` | Lists the default catalog for browsing. Also available on `openAlexPaperService`. |
| `searchPapers(query, 'paper', page = 1)` | `GET /works?search=<query>&page=<page>&per_page=20` | Searches papers using OpenAlex's general search. It is not limited to exact title matches. This is the default mode. |
| `searchPapers(query, 'author', page = 1)` | `GET /works?filter=raw_author_name.search:"<query>"&page=<page>&per_page=20` | Finds papers by the author's name. |
| `getPaperById(id)` | `GET /works/<work-id>` | Gets one paper using its OpenAlex work ID (`W...`). Returns `null` if OpenAlex responds with 404. |

We trim the search text before sending it. If the input is empty, `searchPapers()` returns an empty array without making a request. OpenAlex handles case-insensitive matching for both search modes.

## Paper Data Mapping

OpenAlex returns more fields than we need, so `normalizePaper()` picks out the ones in our shared `Paper` interface. Here's how each field is currently mapped:

| `Paper` field | OpenAlex field | How we handle it |
| --- | --- | --- |
| `id` | `id` | Take the short work ID (`W...`) from the OpenAlex ID. Throw an error if the ID is invalid. |
| `title` | `title` | Use `'Untitled paper'` if it is missing or empty. |
| `authors` | `authorships[].author.display_name` | Collect nonempty author names into an array; use `[]` if there are none. |
| `year` | `publication_year` | Use `null` if missing. |
| `abstract` | `abstract_inverted_index` | Rebuild the abstract from the word positions; use `null` if unavailable. |
| `doi` | `doi` | Use `null` if missing. |
| `url` | `best_oa_location.landing_page_url` → `primary_location.landing_page_url` → `doi` | Use the first available link, or `null`. |
| `publicationDate` | `publication_date` | Use `null` if missing. |
| `researchArea` | `primary_topic.field.display_name` | Use the field name, or `null`. |
| `keywords` | `keywords[].display_name` | Collect nonempty keyword names into an array; use `[]` if there are none. |
| `pdfUrl` | `best_oa_location.pdf_url` → `primary_location.pdf_url` | Use the first available PDF link, or `null`. |

We keep `url` and `pdfUrl` separate because a paper's landing page is not necessarily a PDF. If OpenAlex doesn't provide a PDF link, `pdfUrl` stays `null`.

OpenAlex's own field descriptions are here: [Works attributes](https://help.openalex.org/data/works/attributes/), [Authorships](https://help.openalex.org/data/authorships/), and [Locations](https://help.openalex.org/data/locations/).

## Example Searches

To try out the search bar, you can use:

- **Paper:** `computer vision`
- **Author:** `Geoffrey Hinton`

Both search types use the OpenAlex API and should return matching papers when the service is available.


## API Key and Errors

For now, the frontend calls OpenAlex directly. An API key is **optional**. Without one, the app uses OpenAlex's keyless API. For local testing, you can put this in `.env.local` at the project root:

```dotenv
VITE_OPENALEX_API_KEY=your_api_key
```

Restart Vite after adding or changing it. If the key is set, `openalex.ts` includes it in the request's `api_key` parameter. Don't commit a real key or use a personal key in a public frontend deployment, since Vite exposes `VITE_` variables to the browser.

Here's what happens when a request fails:

- **429 (rate limit):** We try to show the `error`, `message`, and `retryAfter` details returned by OpenAlex. If those details are missing or the response isn't JSON, we still show a fallback message.
- **Other HTTP errors (for example, 503 or 504):** We show the HTTP status code on the search page.
- **404 when looking up a paper by ID:** `getPaperById()` returns `null`.
- **Network errors or unexpected search responses:** The error is passed to the page so it can display a message.

## Current Limitations

Browse and search fetch 20 papers per page. Previous/Next navigation preserves the
submitted query and mode; a new search or Clear returns to page 1. Next is disabled
after a short response. If the last batch has exactly 20 papers, the next page can
be empty; Previous remains available. We do not fetch total counts or use cursor
pagination for exhaustive exports. Requests still depend on OpenAlex availability
and rate limits.

For issue #2, the catalog consists of OpenAlex works, not community uploads. There
is no local draft/published status. Cards show metadata and an abstract preview;
details load the full metadata by route ID. PDF rendering and bookmarks are
separate feature integrations.
