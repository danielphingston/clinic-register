import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { syncService } from '../../sync/service'
import { getBlob } from './attachmentRepo'

// Object URL for a stored blob. `missing` is true when the file isn't on this
// device yet (metadata synced, blob not downloaded). A missing blob is
// requested from Drive straight away (ahead of the background queue);
// `downloading` is true meanwhile. The live query picks the blob up as soon
// as sync stores it. URLs are revoked on change/unmount.
export function useBlobUrl(hash: string | undefined): { url?: string; missing: boolean; loading: boolean; downloading: boolean } {
  const blob = useLiveQuery(async () => (hash ? ((await getBlob(hash)) ?? null) : null), [hash])
  const [url, setUrl] = useState<string>()
  const [downloading, setDownloading] = useState<string>()
  const missing = blob === null && !!hash

  useEffect(() => {
    if (!blob) {
      setUrl(undefined)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])

  useEffect(() => {
    if (!missing || !hash) return
    let live = true
    setDownloading(hash)
    syncService
      .requestBlob(hash)
      .catch(() => false)
      .finally(() => {
        if (live) setDownloading(undefined)
      })
    return () => {
      live = false
    }
  }, [missing, hash])

  return { url: blob ? url : undefined, missing, loading: blob === undefined, downloading: missing && downloading === hash }
}
