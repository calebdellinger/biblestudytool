// Settings › Offline library: save the whole library on this device so everything works when the PC is off.
import { useEffect, useRef, useState } from 'react'
import { download, fetchManifest, loadRecord, mb, removeSection, SECTIONS, storageUse, summarise, type ManifestFile, type SectionId, type SectionStatus } from '../lib/offline'

type Job = { done: number; total: number; bytes: number }

export function OfflineLibrary() {
  const [manifest, setManifest] = useState<ManifestFile[] | null | undefined>(undefined)
  const [status, setStatus] = useState<SectionStatus[] | null>(null)
  const [use, setUse] = useState<Awaited<ReturnType<typeof storageUse>>>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const stop = useRef<AbortController | null>(null)

  async function refresh(m = manifest) {
    const rec = await loadRecord()
    setStatus(summarise(m ?? null, rec))
    setUse(await storageUse())
  }
  useEffect(() => {
    fetchManifest().then(m => { setManifest(m); refresh(m) })
    return () => stop.current?.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(ids: SectionId[]) {
    if (!manifest) return
    setMsg(null)
    const ctl = new AbortController(); stop.current = ctl
    try {
      const { failed } = await download(ids, manifest, (done, total, bytes) => setJob({ done, total, bytes }), ctl.signal)
      setMsg(ctl.signal.aborted ? 'Stopped. What was saved stays saved; tap again to carry on.'
        : failed ? `Saved, except ${failed} ${failed === 1 ? 'file' : 'files'} that didn't come through. Tap again to retry them.` : 'Saved on this device.')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setJob(null); stop.current = null
      await refresh()
    }
  }
  async function remove(id: SectionId) {
    await removeSection(id)
    setMsg(null)
    await refresh()
  }

  const total = status?.reduce((t, s) => t + s.bytes, 0) ?? 0
  const missing = status?.filter(s => s.saved < s.files || s.changed) ?? []
  const toGet = missing.reduce((t, s) => t + (s.bytes - s.savedBytes), 0)
  const changed = status?.reduce((t, s) => t + s.changed, 0) ?? 0

  return (
    <section className="setting-group">
      <h2>Offline library</h2>
      <p className="hint">
        Save the library on this device and the whole app works when your PC is off: every book, search included.
        Notes still sync whenever the PC is back. Things you open are saved as you go anyway.
      </p>
      {manifest === undefined && <p className="muted">Checking with your PC…</p>}
      {manifest === null && <p className="hint">Your PC can't be reached right now, so nothing new can be saved. Everything listed as saved below still works.</p>}

      {status && (
        <ul className="ol-list">
          {SECTIONS.map(sec => {
            const s = status.find(x => x.id === sec.id)!
            const full = s.files > 0 && s.saved >= s.files
            const state = !manifest ? (s.saved ? `${mb(s.savedBytes)} saved` : 'Not saved')
              : full ? (s.changed ? `Saved · ${s.changed} ${s.changed === 1 ? 'file' : 'files'} updated on the PC` : `Saved · ${mb(s.bytes)}`)
                : s.saved ? `${mb(s.savedBytes)} of ${mb(s.bytes)} saved` : `Not saved · ${mb(s.bytes)}`
            return (
              <li key={sec.id} className={`ol-row ${full && !s.changed ? 'is-saved' : ''}`}>
                <div className="ol-text">
                  <span className="ol-name">{sec.name}</span>
                  <span className="ol-about">{sec.about}</span>
                  <span className="ol-state">{state}</span>
                </div>
                <div className="ol-actions">
                  {manifest && (!full || s.changed > 0) && <button className="text-btn" disabled={!!job} onClick={() => save([sec.id])}>{s.saved ? (full ? 'Update' : 'Finish') : 'Save'}</button>}
                  {s.saved > 0 && <button className="text-btn danger" disabled={!!job} onClick={() => remove(sec.id)}>Remove</button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {job ? (
        <div className="ol-progress" role="status">
          <div className="ol-bar"><span style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%` }} /></div>
          <p className="muted">Saving {job.done.toLocaleString()} of {job.total.toLocaleString()} files · {mb(job.bytes)}. Keep the app open until it finishes.</p>
          <button className="text-btn" onClick={() => stop.current?.abort()}>Stop</button>
        </div>
      ) : manifest && missing.length > 0 && (
        <div className="button-row">
          <button className="primary-btn" onClick={() => save(missing.map(s => s.id))}>
            {missing.every(s => s.saved === 0) ? `Save everything · ${mb(total)}` : changed && toGet === 0 ? `Update ${changed} changed ${changed === 1 ? 'file' : 'files'}` : `Save the rest · ${mb(Math.max(toGet, 1))}`}
          </button>
        </div>
      )}
      {msg && <p className="hint">{msg}</p>}
      {use && use.used > 0 && (
        <p className="muted small-note">
          This app is using {mb(use.used)} on this device{use.quota ? ` (room for about ${mb(use.quota)})` : ''}.
          {use.persisted ? ' The device has agreed to keep it.' : ' If the device runs very low on space it may clear what\'s saved here. Your notes are safe on your PC and come back when it syncs; the library can be saved again here.'}
        </p>
      )}
    </section>
  )
}
