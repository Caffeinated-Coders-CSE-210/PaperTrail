import { Link, useParams } from 'react-router'

export function DetailsPage() {
  const { paperId } = useParams<'paperId'>()

  return (
    <>
      <h1>Paper details</h1>
      <p>OpenAlex work <code>{paperId}</code></p>
      {/* Discovery will mount the bookmarks team's BookmarkButton here. */}
      <Link to="/search">Back to search</Link>
    </>
  )
}
