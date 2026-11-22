import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { AuthProvider } from './features/auth/AuthProvider'
import { AccountBookmarksProvider } from './features/bookmarks/AccountBookmarksProvider'
import { AccountLikesProvider } from './features/likes/AccountLikesProvider'
import './styles.css'

if (window.location.protocol === 'http:' && window.location.hostname === 'localhost') {
  // OAuth stores authorization state on the same origin that handles the callback.
  const loopbackUrl = new URL(window.location.href)
  loopbackUrl.hostname = '127.0.0.1'
  window.location.replace(loopbackUrl)
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <AccountBookmarksProvider>
            <AccountLikesProvider>
              <App />
            </AccountLikesProvider>
          </AccountBookmarksProvider>
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  )
}
