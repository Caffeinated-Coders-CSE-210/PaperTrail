import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Paper, PaperId } from '../../shared/paper'
import { LikeButton } from '../likes/LikeButton'
import { BookmarkButton } from '../bookmarks/BookmarkButton'
import { openAlexPaperService } from './openalex'
import type { PaperService } from './service'
import { PdfReader } from '../reader/PdfReader'
import './details.css'

export function DetailsPage({ service = openAlexPaperService }: { service?: PaperService }) {
  const { paperId } = useParams<'paperId'>()
  const [paper, setPaper] = useState<Paper | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fullTextUrl = paper?.pdfUrl ?? paper?.url

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setPaper(null)
    void service.getPaperById(paperId as PaperId).then(
      (paper) => {
        if (!active) return
        setPaper(paper)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Unable to load this paper. Please try again.')
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [paperId, service])

  return (
    <section className="paper-details">
      <h1>{paper?.title ?? 'Paper details'}</h1>
      {loading && <p role="status">Loading paper...</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !paper && <p>Paper not found.</p>}
      {paper && (
        <>
          <p>{paper.authors.join(', ') || 'Authors unavailable'}</p>
          <p>{paper.publicationDate ?? paper.year ?? 'Publication date unavailable'}</p>
          <p>{paper.researchArea ?? 'Research area unavailable'}</p>
          <h2>Abstract</h2>
          <p>{paper.abstract ?? 'Abstract unavailable'}</p>
          <h2>Keywords</h2>
          <p>{paper.keywords.join(', ') || 'Keywords unavailable'}</p>
          <p>
            {fullTextUrl
              ? <a href={fullTextUrl}>Read full text</a>
              : 'Full-text link unavailable'}
          </p>
          <LikeButton paperId={paper.id} />
          <BookmarkButton paper={paper} />
          <PdfReader pdfUrl={paper.pdfUrl} title={paper.title} sourceUrl={paper.url} />
        </>
      )}
      <Link to="/search">Back to Browse</Link>
    </section>
  )
}
