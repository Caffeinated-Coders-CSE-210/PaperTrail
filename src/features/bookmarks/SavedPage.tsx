import { Link } from 'react-router'

export function SavedPage() {
  return (
    <>
      <h1>Saved papers</h1>
      <p>Papers you bookmark will appear here.</p>
      <Link to="/search">Explore papers →</Link>
    </>
  )
}
