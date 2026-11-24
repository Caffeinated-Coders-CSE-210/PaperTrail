import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import type { FetchHandler } from '../auth/session'
import { PdsError } from '../repository/client'
import { postContent, preparePost } from './post'
import './sharing.css'

type PaperInfo = { title: string; url: string }

export function SharePaper(props: PaperInfo) {
  const { identity, fetchHandler, pending } = useAuth()
  if (pending) return null
  if (!identity || !fetchHandler) return <p><Link to="/">Sign in to share on Bluesky</Link></p>
  return <Composer key={identity.did + props.url} {...props} did={identity.did} account={identity.handle ?? identity.did} fetchHandler={fetchHandler} />
}

function Composer({ title, url, did, account, fetchHandler }: PaperInfo & { did: string; account: string; fetchHandler: FetchHandler }) {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState(title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [published, setPublished] = useState('')
  const attempt = useRef<ReturnType<typeof preparePost> | null>(null)
  const sending = useRef(false)
  const { count, valid } = postContent(comment, url)

  async function send() {
    if (sending.current || !valid) return
    sending.current = true
    setBusy(true)
    setError('')
    try {
      attempt.current ??= preparePost(did, fetchHandler, comment, url)
      setPublished(await attempt.current())
    } catch (reason) {
      if (reason instanceof PdsError && ['authentication', 'forbidden', 'permission'].includes(reason.code)) {
        setError('Posting was denied. Sign out on Home and sign in again to authorize Bluesky posts.')
        attempt.current = null
      } else if (reason instanceof PdsError && reason.code === 'rate-limit') {
        setError('Bluesky is limiting requests. Wait a moment and retry.')
      } else {
        setError('The post could not be confirmed. Retry to check or send the same post.')
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  if (published) return <p role="status">Posted to Bluesky. <a href={published}>View post</a></p>
  if (!open) return <p><button onClick={() => setOpen(true)}>Share to Bluesky</button></p>
  return <form className="share-paper" onSubmit={event => { event.preventDefault(); void send() }}>
    <label>Post text <textarea rows={3} value={comment} disabled={busy || Boolean(attempt.current)}
      onChange={event => setComment(event.target.value)} /></label>
    <p>Paper link · <a href={url}>{url}</a></p>
    <p>{count}/300 characters · Posting as {account}</p>
    {!valid && <p role="alert">Shorten the post to fit the Bluesky text limit.</p>}
    {error && <p role="alert">{error}</p>}
    <button disabled={busy || !valid}>{busy ? 'Posting…' : attempt.current ? 'Retry post' : 'Post to Bluesky'}</button>
    {!attempt.current && <button type="button" onClick={() => { setError(''); setOpen(false) }}>Cancel</button>}
  </form>
}
