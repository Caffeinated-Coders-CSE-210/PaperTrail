# Likes

Signed-in users can like a paper from its details page. Paper cards and the details page show the paper's total likes.

## Records

A like is an `app.papertrail.like` record in the user's PDS. The record key is the short OpenAlex work ID, so an account has at most one like per paper. Unliking deletes that record.

```json
{
  "$type": "app.papertrail.like",
  "subject": "https://openalex.org/W2741809807",
  "createdAt": "2026-11-20T12:00:00.000Z"
}
```

Writing likes requires the `repo:app.papertrail.like` OAuth scope. Sessions authorized before this scope was added must sign out and sign in again. See [Authentication](authentication.md) for the deployment metadata.

## Counts

PaperTrail has no backend, so totals come from [Constellation](https://constellation.microcosm.blue), a public index of links between AT Protocol records. The app requests the number of distinct accounts with an `app.papertrail.like` record whose `.subject` links to the paper's OpenAlex URL.

Constellation reads the network firehose, so a new like can take a moment to appear in its count. The UI never changes the fetched total. It shows the total plus the change since the paper loaded: liking adds one, unliking subtracts one, and a failed write restores the previous value. A like that existed when the page loaded is assumed to be in the total. If that like is newer than the index, the total can be one low until the index catches up. The user's own like always counts at least once. If Constellation is unavailable, the details page shows "Likes unavailable", cards hide the count, and liking still works.

## Code

`src/features/likes/` contains the PDS store (`pdsLikes.ts`), the Constellation counter (`constellation.ts`), and the shared state in `LikesContext.tsx`. `AccountLikesProvider` connects the state to `useAuth()` in `main.tsx`. Discovery mounts `LikeButton` on the details page and `LikeCount` on paper cards.
