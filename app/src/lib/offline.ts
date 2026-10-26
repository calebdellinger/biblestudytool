// The offline library: save every data file (Bible texts, commentaries, Spurgeon, the theologians…) on this device,
// so the whole app works when the PC can't be reached. Files go into the same caches the service worker reads from,
// and a small record of what's saved (with each file's size and date) lets a later "Update" fetch only what changed.

/** Must match the service worker's rules in vite.config.ts. */
const GROWING = /^\/data\/(speakers|redletter|intro\.json|plans|theologians\/(index\.json|refs))/
const cacheFor = (p: string) => (GROWING.test(p) ? 'growing-data' : 'bible-data')
const META = 'offline-meta', RECORD = '/__offline/record.json'

export type ManifestFile = [path: string, size: number, mtime: number]
type Record_ = Record<string, [size: number, mtime: number]>

export const SECTIONS = [
  { id: 'core', name: 'Bible and study tools', about: 'Every translation, cross-references, people, maps, introductions, reading plans and speaker colours' },
  { id: 'commentary', name: 'Commentaries', about: 'The verse-by-verse commentaries' },
  { id: 'orig', name: 'Original languages', about: 'Hebrew and Greek words for the interlinear' },
  { id: 'spurgeon', name: 'Spurgeon', about: 'Sermons, the Treasury of David, and Morning and Evening' },
  { id: 'theologians', name: 'Murray, Bounds and Moody', about: 'Their books and the verses they quote' },
] as const
export type SectionId = (typeof SECTIONS)[number]['id']
export function sectionOf(p: string): SectionId {
  const top = p.split('/')[2]
  return top === 'commentary' || top === 'orig' || top === 'spurgeon' || top === 'theologians' ? top : 'core'
}

export type SectionStatus = { id: SectionId; files: number; bytes: number; saved: number; savedBytes: number; changed: number }

/** The PC's list of files. Null when the PC can't be reached. */
export async function fetchManifest(): Promise<ManifestFile[] | null> {
  try {
    const r = await fetch('/api/offline/manifest', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    return (await r.json()).files as ManifestFile[]
  } catch { return null }
}

export async function loadRecord(): Promise<Record_> {
  try {
    const r = await (await caches.open(META)).match(RECORD)
    return r ? await r.json() : {}
  } catch { return {} }
}
async function saveRecord(rec: Record_) {
  await (await caches.open(META)).put(RECORD, new Response(JSON.stringify(rec), { headers: { 'Content-Type': 'application/json' } }))
}

/** What's saved per section. With no manifest (PC away), only what this device knows about. */
export function summarise(manifest: ManifestFile[] | null, rec: Record_): SectionStatus[] {
  const out = new Map<SectionId, SectionStatus>(SECTIONS.map(s => [s.id, { id: s.id, files: 0, bytes: 0, saved: 0, savedBytes: 0, changed: 0 }]))
  if (manifest) {
    for (const [p, size, mtime] of manifest) {
      const s = out.get(sectionOf(p))!
      s.files++; s.bytes += size
      const have = rec[p]
      if (have) { s.saved++; s.savedBytes += have[0]; if (have[0] !== size || have[1] !== mtime) s.changed++ }
    }
  } else {
    for (const [p, [size]] of Object.entries(rec)) { const s = out.get(sectionOf(p))!; s.saved++; s.savedBytes += size; s.files++; s.bytes += size }
  }
  return [...out.values()]
}

/** Save (or bring up to date) the chosen sections. Resumes where it left off if interrupted. */
export async function download(sections: SectionId[], manifest: ManifestFile[], onProgress: (done: number, total: number, bytes: number) => void, signal?: AbortSignal) {
  try { await navigator.storage?.persist?.() } catch { /* not supported */ }
  const rec = await loadRecord()
  const want = manifest.filter(([p, size, mtime]) => sections.includes(sectionOf(p)) && !(rec[p]?.[0] === size && rec[p]?.[1] === mtime))
  const total = want.length
  let done = 0, bytes = 0, sinceSave = 0, failed = 0
  const open = { 'bible-data': await caches.open('bible-data'), 'growing-data': await caches.open('growing-data') }
  const queue = [...want]
  onProgress(0, total, 0)
  async function worker() {
    for (let f; (f = queue.shift());) {
      if (signal?.aborted) return
      const [p, size, mtime] = f
      try {
        const r = await fetch(`${p}?dl`, { cache: 'no-store', signal })
        if (!r.ok) throw new Error(String(r.status))
        await open[cacheFor(p)].put(p, r)
        rec[p] = [size, mtime]
        bytes += size
      } catch (e) {
        if (signal?.aborted) return
        failed++
        if (failed > 20) throw new Error('Too many files failed to download. Is the PC still reachable?', { cause: e })
      }
      done++
      onProgress(done, total, bytes)
      if (++sinceSave >= 100) { sinceSave = 0; await saveRecord(rec) }
    }
  }
  try { await Promise.all(Array.from({ length: 6 }, worker)) } finally { await saveRecord(rec) }
  return { done, failed }
}

/** Remove a section from this device (files you open again are saved as usual). */
export async function removeSection(id: SectionId) {
  const rec = await loadRecord()
  const open = { 'bible-data': await caches.open('bible-data'), 'growing-data': await caches.open('growing-data') }
  for (const p of Object.keys(rec)) {
    if (sectionOf(p) !== id) continue
    await open[cacheFor(p)].delete(p)
    delete rec[p]
  }
  await saveRecord(rec)
}

/** True when every file of the section is saved on this device. */
export async function hasSection(id: SectionId) {
  const rec = await loadRecord()
  return Object.keys(rec).some(p => sectionOf(p) === id)
}

export async function storageUse(): Promise<{ used: number; quota: number; persisted: boolean } | null> {
  try {
    const e = await navigator.storage.estimate()
    return { used: e.usage ?? 0, quota: e.quota ?? 0, persisted: (await navigator.storage.persisted?.()) ?? false }
  } catch { return null }
}

export const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)
