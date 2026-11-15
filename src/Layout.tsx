import { Link, NavLink, Outlet } from 'react-router'

export function Layout() {
  return (
    <>
      <a className="skip-link" href="#content">Skip to content</a>
      <header>
        <div className="bar">
          <Link className="wordmark" to="/">PaperTrail</Link>
          <nav aria-label="Main navigation">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/search">Search</NavLink>
            <NavLink to="/saved">Saved papers</NavLink>
          </nav>
        </div>
      </header>
      <main id="content" tabIndex={-1}><Outlet /></main>
    </>
  )
}
