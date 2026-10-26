// Handwritten notes: photograph pages, straighten and clean them into scans, file them under a category,
// optionally tie them to verses so they show up beside the text. Stored with your notes and synced to the PC.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatRef } from '../lib/bible'
import { addInkPages, categoryPath, createInkNote, deleteNote, getState, saveScanNote, scanPageBlob, scanPageUrl, type Note, type NoteRef } from '../lib/db'
import { analyse, inkMask, trace, PAGE_W, type Analysis, type TraceLayer } from '../lib/ink'
import { editOnOpen, InkPageSvg, PAGE_H } from './Ink'
import { findRefs, parseQuery, type Range } from '../lib/refs'
import { makePage, photoCanvas, type Mode, type Pt } from '../lib/scan'
import { useAsync, useStore } from '../lib/hooks'
import { closeSheet, openNote } from '../lib/ui'
import { CategoryPicker } from './Notes'
import { IconClose, IconTrash } from './Icons'

const MAX_PAGES = 20

/* ---------- small pieces ---------- */
export function ScanPage({ note, page, className }: { note: Note; page: string; className?: string }) {
  const url = useAsync(() => scanPageUrl(note, page).catch(() => ''), [note._id, page, note._attachments?.[page]?.digest])
  if (url === undefined) return <div className={`scan-img is-loading ${className ?? ''}`} />
  if (!url) return <div className={`scan-img is-missing ${className ?? ''}`}>This page hasn't reached this device yet. It will once sync finishes.</div>
  return <img className={`scan-img ${className ?? ''}`} src={url} alt="Scanned handwritten page" loading="lazy" />
}
export function ScanThumb({ note }: { note: Note }) {
  const first = note.pages?.[0]
  if (!first) return null
  return (
    <span className="scan-thumb">
      <ScanPage note={note} page={first} />
      {(note.pages?.length ?? 0) > 1 && <span className="scan-count">{note.pages!.length} pages</span>}
    </span>
  )
}

const refsFrom = (text: string): NoteRef[] => {
  let r: Range[] = findRefs(text)
  if (!r.length) r = text.split(/[;,]/).map(t => parseQuery(t.trim())).filter((x): x is Range => !!x)
  return r.map(x => ({ ...x, confirmed: true }))
}
const refsText = (refs: NoteRef[]) => refs.map(r => formatRef(r.s, r.e)).join('; ')

/* ---------- the buttons in the Notebook ---------- */
export function ScanButton() {
  const [scan, setScan] = useState(false)
  async function write() {
    const n = await createInkNote({ title: '', category: null, refs: [], pages: [{ w: PAGE_W, h: PAGE_H, paper: 'plain', trace: [], strokes: [] }] })
    editOnOpen(n._id); openNote(n._id)
  }
  return (
    <span className="nb-actions">
      <button className="primary-btn small" onClick={write}>Write by hand</button>
      <button className="text-btn small" onClick={() => setScan(true)}>Scan paper notes</button>
      {scan && <PaperScanFlow onClose={() => setScan(false)} />}
    </span>
  )
}

/* ---------- paper notes → vector ink pages ---------- */
type TracePage = { w: number; h: number; paper: 'plain'; trace: TraceLayer[]; strokes: [] }
export function PaperScanFlow({ addTo, onClose }: { addTo?: Note; onClose: () => void }) {
  const [queue, setQueue] = useState<File[]>([])
  const [pages, setPages] = useState<TracePage[]>([])
  const [draft, setDraft] = useState<{ file: File; quarter: number; canvas: HTMLCanvasElement | null; corners: Pt[] } | null>(null)
  const [tr, setTr] = useState<{ a: Analysis; sens: number; colours: boolean; layers: TraceLayer[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [title, setTitle] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [verses, setVerses] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const parsed = useMemo(() => refsFrom(verses), [verses])
  useEffect(() => { picker.current?.click() }, [])   // straight to the camera / photo picker

  useEffect(() => {
    if (draft || tr || !queue.length) return
    const [file, ...rest] = queue
    setQueue(rest)
    open(file, 0)
  }, [queue, draft, tr]) // eslint-disable-line react-hooks/exhaustive-deps
  async function open(file: File, quarter: number) {
    setErr('')
    setDraft({ file, quarter, canvas: null, corners: [] })
    try {
      const c = await photoCanvas(file, quarter)
      setDraft({ file, quarter, canvas: c, corners: [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]] })
    } catch { setErr("That photo couldn't be opened."); setDraft(null) }
  }
  async function toTrace() {
    if (!draft?.canvas) return
    setBusy(true)
    await new Promise(r => setTimeout(r, 30))
    const a = analyse(draft.canvas, draft.corners)
    setTr({ a, sens: 0.5, colours: true, layers: trace(a, inkMask(a, 0.5)) })
    setBusy(false)
  }
  const retrace = useRef(0)
  function retune(o: { sens?: number; colours?: boolean }) {
    if (!tr) return
    const next = { ...tr, ...o }
    setTr(next)
    clearTimeout(retrace.current)
    retrace.current = window.setTimeout(() => setTr(t => (t ? { ...t, layers: trace(t.a, inkMask(t.a, next.sens), next.colours) } : t)), 120)
  }
  function usePage() {
    if (!tr) return
    setPages(p => [...p, { w: PAGE_W, h: Math.round((PAGE_W * tr.a.H) / tr.a.W), paper: 'plain' as const, trace: tr.layers, strokes: [] as [] }].slice(0, MAX_PAGES))
    setTr(null); setDraft(null)
  }
  async function save() {
    if (!pages.length) return
    setBusy(true)
    try {
      if (addTo) { await addInkPages(addTo, pages); onClose(); return }
      const n = await createInkNote({ title: title.trim(), category: cat, refs: parsed, pages })
      onClose(); openNote(n._id)
    } catch (e) { setErr(`Couldn't save: ${(e as Error).message}`); setBusy(false) }
  }
  const kb = (l: TraceLayer[]) => Math.max(1, Math.round(l.reduce((t, x) => t + x.d.length, 0) / 1024))

  return createPortal(

    <div className="scan-flow" role="dialog" aria-label="Scan paper notes">
      <input ref={picker} type="file" accept="image/*" multiple hidden onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) setQueue(q => [...q, ...f]); else if (!pages.length && !draft) onClose() }} />
      <header className="scan-top">
        <button className="icon-btn" onClick={onClose} aria-label="Cancel"><IconClose /></button>
        <h2>{draft ? `Page ${pages.length + 1}` : addTo ? 'Add scanned pages' : 'Scan paper notes'}</h2>
        <span />
      </header>

      {tr ? (
        <div className="scan-adjust">
          <div className="trace-preview"><InkPageSvg page={{ w: PAGE_W, h: Math.round((PAGE_W * tr.a.H) / tr.a.W), paper: 'plain', trace: tr.layers }} strokes={[]} /></div>
          <label className="trace-slider">
            <span>Lighter</span>
            <input type="range" min={0} max={1} step={0.05} value={tr.sens} onChange={e => retune({ sens: +e.target.value })} aria-label="How much faint ink to keep" />
            <span>Darker</span>
          </label>
          <p className="hint small">Slide right to keep faint pencil, left to drop smudges and shadows. This page takes about {kb(tr.layers)} KB.</p>
          <div className="seg small">
            <button className={tr.colours ? 'is-on' : ''} onClick={() => retune({ colours: true })}>Keep pen colours</button>
            <button className={!tr.colours ? 'is-on' : ''} onClick={() => retune({ colours: false })}>All one ink</button>
          </div>
          <div className="button-row">
            <button className="primary-btn" onClick={usePage}>Use this page</button>
            <button className="text-btn" onClick={() => setTr(null)}>Back to corners</button>
          </div>
        </div>
      ) : draft ? (
        <div className="scan-adjust">
          {draft.canvas ? <CornerEditor canvas={draft.canvas} corners={draft.corners} onChange={corners => setDraft({ ...draft, corners })} /> : <div className="loading-lines"><span /><span /></div>}
          <p className="hint small">Drag the corners onto the corners of the page.</p>
          <div className="scan-tools">
            <button className="text-btn small" onClick={() => open(draft.file, draft.quarter + 1)}>Rotate</button>
            <button className="text-btn small" onClick={() => draft.canvas && setDraft({ ...draft, corners: [[0, 0], [draft.canvas.width, 0], [draft.canvas.width, draft.canvas.height], [0, draft.canvas.height]] })}>Whole photo</button>
          </div>
          <div className="button-row">
            <button className="primary-btn" disabled={!draft.canvas || busy} onClick={toTrace}>{busy ? 'Turning it into ink…' : 'Next'}</button>
            <button className="text-btn" onClick={() => setDraft(null)}>Skip</button>
          </div>
        </div>
      ) : (
        <div className="scan-review">
          <ol className="scan-pages">
            {pages.map((p, i) => (
              <li key={i}>
                <div className="ink-thumb"><InkPageSvg page={p} strokes={[]} /></div>
                <span className="scan-page-n">{i + 1}</span>
                <button className="icon-btn small scan-page-x" aria-label={`Remove page ${i + 1}`} onClick={() => setPages(ps => ps.filter((_, j) => j !== i))}><IconTrash size={15} /></button>
              </li>
            ))}
            {pages.length < MAX_PAGES && (
              <li className="scan-add"><button onClick={() => picker.current?.click()}><span>+ Add a page</span></button></li>
            )}
          </ol>
          {!addTo && pages.length > 0 && (
            <div className="scan-form">
              <label className="scan-field"><span>Title</span><input className="field" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sermon notes, Isaiah 55" /></label>
              <div className="scan-field"><span>Category</span><CategoryPicker value={cat} onChange={setCat} /></div>
              <label className="scan-field"><span>Verses it's about <small className="muted">(optional; shows beside the text)</small></span>
                <input className="field" value={verses} onChange={e => setVerses(e.target.value)} placeholder="e.g. Isaiah 55; John 15:1-11" /></label>
              {verses.trim() && <p className="hint small">{parsed.length ? parsed.map(r => formatRef(r.s, r.e)).join(' · ') : 'No references recognised yet.'}</p>}
            </div>
          )}
          <div className="button-row">
            <button className="primary-btn" disabled={!pages.length || busy} onClick={save}>{busy ? 'Saving…' : addTo ? `Add ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` : 'Save note'}</button>
            <button className="text-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="sel-error">{err}</p>}
    </div>,
    document.body,
  )
}

/* ---------- capture → straighten → details → save ---------- */
type Draft = { file: File; quarter: number; canvas: HTMLCanvasElement | null; corners: Pt[]; mode: Mode }

export function ScanFlow({ files, note, onClose }: { files: File[]; note?: Note; onClose: () => void }) {
  const [queue, setQueue] = useState<File[]>(files)
  const [pages, setPages] = useState<(string | Blob)[]>(note?.pages ?? [])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [title, setTitle] = useState(note?.title ?? '')
  const [cat, setCat] = useState<string | null>(note?.category ?? null)
  const [verses, setVerses] = useState(note ? refsText(note.refs) : '')
  const lastMode = useRef<Mode>('scan')

  // Load the next photo in the queue.
  useEffect(() => {
    if (draft || !queue.length) return
    const [file, ...rest] = queue
    setQueue(rest)
    open(file, 0)
  }, [queue, draft]) // eslint-disable-line react-hooks/exhaustive-deps
  async function open(file: File, quarter: number, mode: Mode = lastMode.current) {
    setErr('')
    setDraft({ file, quarter, canvas: null, corners: [], mode })
    try {
      const c = await photoCanvas(file, quarter)
      setDraft({ file, quarter, canvas: c, corners: [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]], mode })
    } catch { setErr("That photo couldn't be opened."); setDraft(null) }
  }
  async function usePage() {
    if (!draft?.canvas) return
    setBusy(true)
    try {
      lastMode.current = draft.mode
      const blob = await makePage(draft.canvas, draft.corners, draft.mode)
      setPages(p => [...p, blob].slice(0, MAX_PAGES))
      setDraft(null)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  async function save() {
    if (!pages.length) return
    setBusy(true)
    try {
      const saved = await saveScanNote({ id: note?._id, title: title.trim(), category: cat, refs: refsFrom(verses), pages })
      onClose()
      if (!note) openNote(saved._id)
    } catch (e) { setErr(`Couldn't save: ${(e as Error).message}`); setBusy(false) }
  }
  const parsed = useMemo(() => refsFrom(verses), [verses])

  return createPortal(

    <div className="scan-flow" role="dialog" aria-label="Scan handwritten notes">
      <header className="scan-top">
        <button className="icon-btn" onClick={onClose} aria-label="Cancel"><IconClose /></button>
        <h2>{draft ? `Page ${pages.length + 1}` : note ? 'Edit scan' : 'New handwritten note'}</h2>
        <span />
      </header>

      {draft ? (
        <div className="scan-adjust">
          {draft.canvas ? <CornerEditor canvas={draft.canvas} corners={draft.corners} onChange={corners => setDraft({ ...draft, corners })} /> : <div className="loading-lines"><span /><span /></div>}
          <p className="hint small">Drag the corners onto the corners of the page. It will be straightened.</p>
          <div className="scan-tools">
            <div className="seg small">
              <button className={draft.mode === 'scan' ? 'is-on' : ''} onClick={() => setDraft({ ...draft, mode: 'scan' })}>Scan</button>
              <button className={draft.mode === 'photo' ? 'is-on' : ''} onClick={() => setDraft({ ...draft, mode: 'photo' })}>Colour</button>
            </div>
            <button className="text-btn small" onClick={() => open(draft.file, draft.quarter + 1, draft.mode)}>Rotate</button>
            <button className="text-btn small" onClick={() => draft.canvas && setDraft({ ...draft, corners: [[0, 0], [draft.canvas.width, 0], [draft.canvas.width, draft.canvas.height], [0, draft.canvas.height]] })}>Whole photo</button>
          </div>
          <div className="button-row">
            <button className="primary-btn" disabled={!draft.canvas || busy} onClick={usePage}>{busy ? 'Cleaning up…' : 'Use this page'}</button>
            <button className="text-btn" onClick={() => setDraft(null)}>Skip</button>
          </div>
        </div>
      ) : (
        <div className="scan-review">
          <ol className="scan-pages">
            {pages.map((p, i) => (
              <li key={i}>
                {typeof p === 'string' && note ? <ScanPage note={note} page={p} /> : <BlobImg blob={p as Blob} />}
                <span className="scan-page-n">{i + 1}</span>
                <button className="icon-btn small scan-page-x" aria-label={`Remove page ${i + 1}`} onClick={() => setPages(ps => ps.filter((_, j) => j !== i))}><IconTrash size={15} /></button>
              </li>
            ))}
            {pages.length < MAX_PAGES && (
              <li className="scan-add">
                <label>
                  <span>+ Add a page</span>
                  <input type="file" accept="image/*" multiple hidden onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) setQueue(q => [...q, ...f]) }} />
                </label>
              </li>
            )}
          </ol>
          <div className="scan-form">
            <label className="scan-field"><span>Title</span>
              <input className="field" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sermon notes, Isaiah 55" />
            </label>
            <div className="scan-field"><span>Category</span><CategoryPicker value={cat} onChange={setCat} /></div>
            <label className="scan-field"><span>Verses it's about <small className="muted">(optional; shows beside the text)</small></span>
              <input className="field" value={verses} onChange={e => setVerses(e.target.value)} placeholder="e.g. Isaiah 55; John 15:1-11" />
            </label>
            {verses.trim() && <p className="hint small">{parsed.length ? parsed.map(r => formatRef(r.s, r.e)).join(' · ') : 'No references recognised yet.'}</p>}
          </div>
          <div className="button-row">
            <button className="primary-btn" disabled={!pages.length || busy} onClick={save}>{busy ? 'Saving…' : note ? 'Save changes' : 'Save note'}</button>
            <button className="text-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="sel-error">{err}</p>}
    </div>,
    document.body,
  )
}

function BlobImg({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img className="scan-img" src={url} alt="Scanned page" />
}

/** The photo with four draggable corners. */
function CornerEditor({ canvas, corners, onChange }: { canvas: HTMLCanvasElement; corners: Pt[]; onChange: (c: Pt[]) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(0)
  const drag = useRef<number | null>(null)
  useEffect(() => {
    const fit = () => {
      const box = wrap.current; if (!box) return
      const maxW = box.parentElement!.clientWidth, maxH = Math.min(innerHeight * 0.58, 720)
      const k = Math.min(maxW / canvas.width, maxH / canvas.height)
      const v = view.current!
      const dpr = devicePixelRatio || 1
      v.width = Math.round(canvas.width * k * dpr); v.height = Math.round(canvas.height * k * dpr)
      v.style.width = `${canvas.width * k}px`; v.style.height = `${canvas.height * k}px`
      v.getContext('2d')!.drawImage(canvas, 0, 0, v.width, v.height)
      setScale(k)
    }
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [canvas])
  const toSrc = (e: React.PointerEvent): Pt => {
    const r = wrap.current!.getBoundingClientRect()
    return [Math.max(0, Math.min(canvas.width, (e.clientX - r.left) / scale)), Math.max(0, Math.min(canvas.height, (e.clientY - r.top) / scale))]
  }
  const pts = corners.map(([x, y]) => [x * scale, y * scale])
  return (
    <div className="corner-wrap" ref={wrap} style={{ width: canvas.width * scale, height: canvas.height * scale }}
      onPointerMove={e => { if (drag.current === null) return; const c = [...corners]; c[drag.current] = toSrc(e); onChange(c) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <canvas ref={view} />
      {scale > 0 && (
        <svg className="corner-quad" width={canvas.width * scale} height={canvas.height * scale}>
          <polygon points={pts.map(p => p.join(',')).join(' ')} />
        </svg>
      )}
      {scale > 0 && pts.map(([x, y], i) => (
        <button key={i} className="corner-handle" style={{ left: x, top: y }} aria-label={['Top left', 'Top right', 'Bottom right', 'Bottom left'][i] + ' corner'}
          onPointerDown={e => { e.preventDefault(); (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId); drag.current = i }} />
      ))}
    </div>
  )
}

/* ---------- a handwritten note, opened in the note sheet ---------- */
export function ScanNoteBody({ noteId }: { noteId: string }) {
  const store = useStore()
  const note = store.notes.find(n => n._id === noteId)
  const [editing, setEditing] = useState<File[] | null>(null)
  if (!note) return <p className="empty"><span>This note was deleted.</span></p>
  async function share(page: string) {
    const blob = await scanPageBlob(note!, page)
    const file = new File([blob], `${note!.title || 'Handwritten note'}.jpg`, { type: 'image/jpeg' })
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }) } catch { /* closed */ } return }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
  }
  return (
    <div className="scan-note">
      <header className="sheet-head scan-note-head">
        <div>
          <h2>{note.title || 'Handwritten note'}</h2>
          <p className="muted small-note">
            {note.category ? categoryPath(note.category) : 'No category'}
            {note.refs.length ? ` · ${note.refs.map(r => formatRef(r.s, r.e, true)).join(', ')}` : ''}
            {` · ${new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
          </p>
        </div>
        <button className="icon-btn" onClick={closeSheet} aria-label="Close"><IconClose /></button>
      </header>
      <div className="scan-note-pages">
        {(note.pages ?? []).map(p => (
          <figure key={p}>
            <a href="#" onClick={async e => { e.preventDefault(); window.open(await scanPageUrl(note, p), '_blank') }} aria-label="Open full size"><ScanPage note={note} page={p} /></a>
            <figcaption><button className="text-btn small" onClick={() => share(p)}>Save or share page</button></figcaption>
          </figure>
        ))}
      </div>
      <div className="button-row">
        <button className="text-btn" onClick={() => setEditing([])}>Edit, add pages or change category</button>
        <button className="text-btn danger" onClick={async () => { if (confirm('Delete this handwritten note and its pages?')) { await deleteNote(getState().notes.find(n => n._id === noteId)!); closeSheet() } }}>Delete</button>
      </div>
      {editing && <ScanFlow files={editing} note={note} onClose={() => setEditing(null)} />}
    </div>
  )
}
