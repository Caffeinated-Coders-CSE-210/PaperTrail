import { useMemo, useRef } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { createPublicationService } from './service'
import { PublishPage } from './PublishPage'
import { MyPublicationsPage } from './MyPublicationsPage'

/** Keeps account-bound requests separate from public publication reads. */
export function AccountPublishingPage({ view }: { view: 'publish' | 'list' }) {
  const { identity, fetchHandler, pending } = useAuth()
  const current = useRef({ identity, fetchHandler, pending })
  current.current = { identity, fetchHandler, pending }
  const did = identity?.did
  const service = useMemo(() => did && fetchHandler && pending === null ? createPublicationService({
    did, fetchHandler,
    isActive: () => current.current.identity?.did === did && current.current.fetchHandler === fetchHandler && current.current.pending === null,
  }) : null, [did, fetchHandler, pending])
  const props = { service, authPending: pending === 'restore' }
  return view === 'publish'
    ? <PublishPage key={`${did ?? 'signed-out'}:${pending ?? 'ready'}`} {...props} />
    : <MyPublicationsPage key={`${did ?? 'signed-out'}:${pending ?? 'ready'}`} {...props} />
}
