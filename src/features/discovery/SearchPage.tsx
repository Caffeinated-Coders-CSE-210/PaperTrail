import { Link } from 'react-router'
import { paperPath } from '../../shared/paper'

export function SearchPage() {
  return (
    <>
      <h1>Search results</h1>
      <p>OpenAlex search results will appear here.</p>
      <Link to={paperPath('W2741809807')}>Preview paper details →</Link>
    </>
  )
}
