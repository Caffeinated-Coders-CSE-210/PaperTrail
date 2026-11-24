import { Link, Route, Routes } from 'react-router'
import { Layout } from './Layout'
import { HomePage } from './features/auth/HomePage'
import { SavedPage } from './features/bookmarks/SavedPage'
import { DetailsPage } from './features/discovery/DetailsPage'
import { AccountPublishingPage } from './features/publishing/AccountPublishingPage'
import { PublicationDetailsPage } from './features/publishing/PublicationDetailsPage'
import { SearchPage } from './features/discovery/SearchPage'

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="papers/:paperId" element={<DetailsPage />} />
        <Route path="publish" element={<AccountPublishingPage view="publish" />} />
        <Route path="publications" element={<AccountPublishingPage view="list" />} />
        <Route path="publications/:repoDid/:rkey" element={<PublicationDetailsPage />} />
        <Route path="saved" element={<SavedPage />} />
        <Route
          path="*"
          element={
            <>
              <h1>Page not found</h1>
              <p><Link to="/">Return home</Link></p>
            </>
          }
        />
      </Route>
    </Routes>
  )
}
