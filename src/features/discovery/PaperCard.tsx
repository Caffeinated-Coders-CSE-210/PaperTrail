import { Link } from 'react-router'
import { paperPath, type Paper } from '../../shared/paper'
import { LikeCount } from '../likes/LikeCount'
import './paper-card.css'

export function PaperCard({ paper }: { paper: Paper }) {
  return (
    <article className="paper-card">
      <h2><Link to={paperPath(paper.id)}>{paper.title}</Link></h2>
      <p>{paper.authors.join(', ') || 'Authors unavailable'}</p>
      <p className="paper-card-meta">
        <span>{paper.publicationDate ?? paper.year ?? 'Publication date unavailable'}</span>
        <span>{paper.researchArea ?? 'Research area unavailable'}</span>
        <LikeCount paperId={paper.id} />
      </p>
      <p className="paper-card-abstract">{paper.abstract ?? 'Abstract unavailable'}</p>
    </article>
  )
}
