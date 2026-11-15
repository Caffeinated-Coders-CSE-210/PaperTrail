import { Link } from 'react-router'

export function HomePage() {
  return (
    <>
      <h1>Research notebook</h1>
      <p>This is where you’ll sign in with your AT Protocol account.</p>
      <Link to="/search">Explore papers →</Link>
    </>
  )
}
