import { useEffect, useRef, useState } from 'react'
import type { PaperId } from '../../shared/paper'
import { LIKE_COLLECTION } from '../likes/lexicon'
import { listPaperRecords } from './discovery'

export function PaperReaders({ id }: { id: PaperId }) {
  const [dids, setDids] = useState<string[]>([])
  const [started, setStarted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [cursor, setCursor] = useState<string>()
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])

  async function load() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setLoading(true)
    setStarted(true)
    setError(false)
    try {
      const page = await listPaperRecords({ source: 'openalex', id }, LIKE_COLLECTION, cursor, controller.signal)
      if (controller.signal.aborted) return
      setDids(previous => [...new Set([...previous, ...page.records.map(record => record.creatorDid)])])
      if (page.failedUris.length) setError(true)
      else setCursor(page.cursor)
    } catch {
      if (!controller.signal.aborted) setError(true)
    } finally {
      active.current = null
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return <section aria-label="Readers who liked this paper">
    {(!started || cursor || error) && <button disabled={loading} onClick={() => void load()}>
      {error ? 'Retry readers' : started ? 'Load more readers' : 'See who liked this paper'}
    </button>}
    {loading && <p role="status">Loading readers…</p>}
    {error && <p role="alert">Some readers could not be loaded.</p>}
    {started && !loading && !error && !cursor && !dids.length && <p>No public likes found.</p>}
    {dids.length > 0 && <ul>{dids.map(did => <li key={did}>{did}</li>)}</ul>}
  </section>
}
