import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PdfReader } from '../../src/features/reader/PdfReader'
import '../../src/styles.css'

// Development/browser-test entry only. This page is not part of the app routes
// or its normal production build; it also works before DetailsPage is integrated.
const sample = new URL('./sample.pdf', import.meta.url).href

function ReaderChecks() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(sample)
  const [customUrl, setCustomUrl] = useState('')
  const [narrow, setNarrow] = useState(false)
  return <main>
    <h1>PDF reader checks</h1>
    <p>Local fixture: three pages with different page sizes. No live API is needed.</p>
    <div>
      <button onClick={() => setPdfUrl(sample)}>Local PDF</button>{' '}
      <button onClick={() => setPdfUrl(null)}>No PDF</button>{' '}
      <button onClick={() => setPdfUrl(new URL('./broken.pdf', import.meta.url).href)}>Invalid PDF</button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); setPdfUrl(customUrl) }}>
      <label>External PDF URL <input type="url" value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} required /></label>
      <button>Load external PDF</button>
    </form>
    <label><input type="checkbox" checked={narrow} onChange={(event) => setNarrow(event.target.checked)} /> 390px reader container</label>
    <div style={{ width: narrow ? 390 : '100%', maxWidth: '100%' }}>
      <PdfReader pdfUrl={pdfUrl} title="PaperTrail test paper" sourceUrl="https://openalex.org" />
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><ReaderChecks /></StrictMode>)
