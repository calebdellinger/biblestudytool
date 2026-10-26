// Words of Jesus, as character ranges in each verse (see scripts/build_redletter.py).
// KJV: from the KJV's own red-letter marks. BSB: the BSB's quotation marks, with the speaker matched against the KJV.
import { useEffect, useState } from 'react'
type Ranges = Record<string, [number, number][]>
const cache = new Map<string, Promise<Ranges>>()
export function loadRedLetters(tr: string): Promise<Ranges> {
  if (!cache.has(tr)) cache.set(tr, fetch(`/data/redletter/${tr}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})))
  return cache.get(tr)!
}
/** Red-letter ranges for one translation, or null while loading / when switched off. */
export function useRedLetters(tr: string, on: boolean): Ranges | null {
  const [data, setData] = useState<Ranges | null>(null)
  useEffect(() => {
    let live = true
    if (!on) { setData(null); return }
    loadRedLetters(tr).then(d => { if (live) setData(d) })
    return () => { live = false }
  }, [tr, on])
  return data
}
