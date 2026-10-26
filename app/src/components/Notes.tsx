import { useEffect, useMemo, useRef, useState } from 'react'
import { formatRef, splitVid, verseText } from '../lib/bible'
import { findRefs, type Range } from '../lib/refs'
import {
  addCategory, categoryPath, deleteCategory, deleteNote, getState, noteRanges, renameCategory, saveMark, saveNote,
  useMarkVersion, type Category, type Mark, type Note,
} from '../lib/db'
import { closeSheet, openNote, useSheet } from '../lib/ui'
import { usePrefs, useAsync, useMedia, useStore } from '../lib/hooks'
import { goToMark } from './Annotate'
import { IconClose, IconDown, IconPlus, IconSearch, IconTrash } from './Icons'
import { ScanButton, ScanNoteBody, ScanThumb } from './Scan'
import { InkNoteBody, InkThumb } from './Ink'
import { createSermon, isEmptySermon } from '../lib/sermon'
import { go } from '../lib/hooks'

/* ---------- the quoted passage a note hangs on ---------- */
export function AnchorQuote({ m, onRemove }: { m: Mark; onRemove?: () => void }) {
  const prefs = usePrefs()
  const whole = m.src.kind === 'bible' && !m.quote
  const text = useAsync(async () => {
    if (!whole || m.src.kind !== 'bible') return m.quote
    if (m.src.e - m.src.s > 3) return ''
    const parts = []
    for (let v = m.src.s; v <= m.src.e; v++) parts.push(await verseText(prefs.translation, v))
    return parts.join(' ')
  }, [m._id, m.quote, prefs.translation])
  const label = m.src.kind === 'bible' ? formatRef(m.src.s, m.src.e) : m.src.label
  return (
    <figure className={`anchor ${m.color ? `anchor-${m.color}` : ''}`}>
      {text ? <blockquote>{text.length > 280 ? `${text.slice(0, 280)}…` : text}</blockquote> : null}
      <figcaption>
        <button className="anchor-src" onClick={() => { closeSheet(); goToMark(m) }}>{label}</button>
        {m.src.kind === 'text' && m.links.length > 0 && <span className="muted">, linked to {m.links.map(l => formatRef(l.s, l.e, true)).join(', ')}</span>}
        {onRemove && <button className="anchor-x" onClick={onRemove} aria-label="Detach this highlight from the note">×</button>}
      </figcaption>
    </figure>
  )
}

/* ---------- category picker (used inside the note sheet) ---------- */
export function CategoryPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { categories } = useStore()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    addEventListener('pointerdown', off)
    return () => removeEventListener('pointerdown', off)
  }, [open])
  if (!categories.length) return <a className="cat-hint" href="#/settings" onClick={closeSheet}>Add categories in Settings</a>
  const tops = categories.filter(c => !c.parent)
  return (
    <div className="cat-picker" ref={box}>
      <button className={`cat-btn ${value ? 'has-value' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        {value ? categoryPath(value) : 'Category'}<IconDown size={14} />
      </button>
      {open && (
        <ul className="cat-menu" role="listbox">
          <li><button role="option" aria-selected={!value} onClick={() => { onChange(null); setOpen(false) }} className="muted">No category</button></li>
          {tops.map(t => (
            <li key={t.id}>
              <button role="option" aria-selected={value === t.id} onClick={() => { onChange(t.id); setOpen(false) }}>{t.name}</button>
              {categories.filter(c => c.parent === t.id).map(c => (
                <button key={c.id} role="option" aria-selected={value === c.id} className="sub" onClick={() => { onChange(c.id); setOpen(false) }}>{c.name}</button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------- the note sheet: one place to write any note ---------- */
export function NoteSheet() {
  const sheet = useSheet()
  const wide = useMedia('(min-width: 1000px)')
  useMarkVersion()
  if (sheet.mode === 'closed') return null
  return (
    <>
      <div className="note-backdrop" onClick={closeSheet} />
      <aside className={`note-sheet ${wide ? '' : 'as-sheet'}`} role="dialog" aria-label={sheet.mode === 'pick' ? 'Add to a note' : 'Note'}>
        {sheet.mode === 'note' && sheet.noteId && getState().notes.find(n => n._id === sheet.noteId)?.kind === 'ink'
          ? <InkNoteBody key={sheet.noteId} noteId={sheet.noteId} />
          : sheet.mode === 'note' && sheet.noteId && getState().notes.find(n => n._id === sheet.noteId)?.kind === 'handwritten'
          ? <ScanNoteBody key={sheet.noteId} noteId={sheet.noteId} />
          : sheet.mode === 'note' ? <NoteEditorBody key={sheet.noteId ?? 'new'} noteId={sheet.noteId} anchors={sheet.anchors} typed={sheet.typed} />
          : <NotePickerBody markId={sheet.markId} />}
      </aside>
    </>
  )
}

function NoteEditorBody({ noteId, anchors: initAnchors, typed }: { noteId: string | null; anchors: string[]; typed?: Range[] }) {
  const { notes, marks } = getState()
  const existing = noteId ? notes.find(n => n._id === noteId) ?? null : null
  const [body, setBody] = useState(existing?.body ?? '')
  const [category, setCategory] = useState<string | null>(existing?.category ?? null)
  const [anchors, setAnchors] = useState<string[]>(existing?.anchors ?? initAnchors)
  const [saved, setSaved] = useState(!!existing)
  const ta = useRef<HTMLTextAreaElement>(null)
  const prefs = usePrefs()
  useEffect(() => { if (!existing) ta.current?.focus() }, [existing])
  useEffect(() => { const t = ta.current; if (t) { t.style.height = 'auto'; t.style.height = `${Math.max(140, t.scrollHeight)}px` } }, [body])

  const mentioned = useMemo(() => findRefs(body), [body])
  const legacy = existing && !existing.anchors?.length ? existing.refs : []
  const dirty = !existing || body !== existing.body || category !== (existing.category ?? null) || anchors.join() !== (existing.anchors ?? []).join()

  async function save(close = true) {
    if (!body.trim()) { if (close) closeSheet(); return }
    let a = anchors
    // A note started from a verse or chapter gets a colourless highlight over that passage to hang on.
    if (!a.length && typed?.length) {
      const made = await Promise.all(typed.map(r => saveMark({ src: { kind: 'bible', tr: prefs.translation, s: r.s, e: r.e, so: 0, eo: -1 }, quote: '', color: null })))
      a = made.map(m => m._id)
      setAnchors(a)
    }
    const refs = noteRanges(a, [...legacy, ...mentioned])
    await saveNote({ ...(existing ?? {}), body: body.trim(), category, anchors: a, refs })
    setSaved(true)
    if (close) closeSheet()
  }
  async function remove() {
    if (existing && confirm('Delete this note? Its highlights stay.')) { await deleteNote(existing); closeSheet() }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); save() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const anchorMarks = anchors.map(id => marks.get(id)).filter(Boolean) as Mark[]
  const title = anchorMarks[0] ? (anchorMarks[0].src.kind === 'bible' ? formatRef(anchorMarks[0].src.s, anchorMarks[0].src.e) : anchorMarks[0].src.label)
    : typed?.[0] ? formatRef(typed[0].s, typed[0].e) : legacy[0] ? formatRef(legacy[0].s, legacy[0].e) : 'Note'

  return (
    <>
      <header className="ns-head">
        <div>
          <p className="ns-kicker">{existing ? (saved && !dirty ? 'Saved' : 'Editing') : 'New note'}</p>
          <h2 className="ns-title">{title}</h2>
        </div>
        <button className="icon-btn" onClick={() => save()} aria-label="Save and close"><IconClose /></button>
      </header>

      {anchorMarks.length > 0 && (
        <div className="ns-anchors">
          {anchorMarks.map(m => <AnchorQuote key={m._id} m={m} onRemove={anchorMarks.length > 1 || existing ? () => setAnchors(anchors.filter(a => a !== m._id)) : undefined} />)}
        </div>
      )}

      <textarea ref={ta} className="ns-body" value={body} onChange={e => setBody(e.target.value)}
        placeholder="Write what you see. References like Rom 8:28 link themselves." aria-label="Note" />

      {mentioned.length > 0 && (
        <div className="ref-chips" aria-label="Verses mentioned">
          <span className="muted small">Also shows on</span>
          {mentioned.map(r => <span key={`${r.s}-${r.e}`} className="chip">{formatRef(r.s, r.e, true)}</span>)}
        </div>
      )}

      <footer className="ns-foot">
        <CategoryPicker value={category} onChange={setCategory} />
        <span className="ns-spacer" />
        {existing && <button className="icon-btn" onClick={remove} aria-label="Delete note" title="Delete note"><IconTrash size={18} /></button>}
        <button className="primary-btn" onClick={() => save()} disabled={!body.trim()}>Save</button>
      </footer>
    </>
  )
}

/* ---------- add a highlight to an existing note ---------- */
function NotePickerBody({ markId }: { markId: string }) {
  const { notes, marks } = getState()
  const [q, setQ] = useState('')
  const m = marks.get(markId)
  const list = useMemo(() => {
    const f = q.trim().toLowerCase()
    return [...notes].filter(n => n.kind !== 'sermon').filter(n => !f || n.body.toLowerCase().includes(f) || categoryPath(n.category).toLowerCase().includes(f))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50)
  }, [notes, q])
  async function choose(n: Note) {
    const anchors = [...new Set([...(n.anchors ?? []), markId])]
    const typed = n.anchors?.length ? [] : (n.refs ?? [])
    await saveNote({ ...n, anchors, refs: noteRanges(anchors, [...typed, ...findRefs(n.body)]) })
    openNote(n._id)
  }
  return (
    <>
      <header className="ns-head">
        <div><p className="ns-kicker">Add to a note</p><h2 className="ns-title">Which note?</h2></div>
        <button className="icon-btn" onClick={closeSheet} aria-label="Close"><IconClose /></button>
      </header>
      {m && <AnchorQuote m={m} />}
      <div className="sp-search compact"><IconSearch size={16} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a note" aria-label="Find a note" /></div>
      <ol className="pick-list">
        {list.map(n => (
          <li key={n._id}><button className="pick-item" onClick={() => choose(n)}>
            {n.category && <span className="note-cat">{categoryPath(n.category)}</span>}
            <span className="pick-body">{n.body}</span>
          </button></li>
        ))}
        {!list.length && <li className="muted">{notes.length ? 'No notes match.' : 'You have no notes yet.'}</li>}
      </ol>
      <button className="text-btn" onClick={() => openNote(null, [markId])}><IconPlus size={14} /> Start a new note instead</button>
    </>
  )
}

/* ---------- a note in a list ---------- */
export function NoteCard({ note, showAnchor = true }: { note: Note; showAnchor?: boolean }) {
  const { marks } = getState()
  useMarkVersion()
  const anchorMarks = (note.anchors ?? []).map(id => marks.get(id)).filter(Boolean) as Mark[]
  const first = anchorMarks[0]
  const date = new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const sm = note.kind === 'sermon' ? note.sermon : null
  const where = sm ? `Sermon · ${note.title || 'Untitled'}` : note.kind === 'handwritten' || note.kind === 'ink' ? (note.title || 'Handwritten note') + (note.refs[0] ? ` · ${formatRef(note.refs[0].s, note.refs[0].e, true)}` : '')
    : first ? (first.src.kind === 'bible' ? formatRef(first.src.s, first.src.e) : first.src.label)
    : note.refs[0] ? formatRef(note.refs[0].s, note.refs[0].e) : ''
  return (
    <article className="note-card" role="button" tabIndex={0} onClick={() => openNote(note._id)} onKeyDown={e => { if (e.key === 'Enter') openNote(note._id) }}>
      <header className="note-card-head">
        <span className="note-where">{where}{anchorMarks.length > 1 ? ` and ${anchorMarks.length - 1} more` : ''}</span>
        {note.category && <span className="note-cat">{categoryPath(note.category)}</span>}
      </header>
      {showAnchor && first?.quote && <blockquote className={`note-quote ${first.color ? `anchor-${first.color}` : ''}`}>{first.quote.length > 160 ? `${first.quote.slice(0, 160)}…` : first.quote}</blockquote>}
      {note.kind === 'ink' ? <InkThumb note={note} /> : note.kind === 'handwritten' ? <ScanThumb note={note} /> : <div className="note-body">{sm && <span className="note-sub">{[sm.speaker, sm.series].filter(Boolean).join(' · ')}</span>}{note.body}</div>}
      <footer className="note-foot"><span className="note-date">{date}</span></footer>
    </article>
  )
}

/* ---------- Notebook: every note, by category ---------- */
export function Notebook() {
  const { notes, categories } = useStore()
  useMarkVersion()
  const [cat, setCat] = useState<string>('all')
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<'recent' | 'bible'>('recent')
  const [sermons, setSermons] = useState(false)
  const wide = useMedia('(min-width: 860px)')
  const tops = categories.filter(c => !c.parent)
  const inCat = (n: Note, id: string) => id === 'all' || (id === 'none' ? !n.category : n.category === id || categories.find(c => c.id === n.category)?.parent === id)
  const count = (id: string) => notes.filter(n => inCat(n, id)).length
  const list = useMemo(() => {
    const f = q.trim().toLowerCase()
    const { marks } = getState()
    const l = notes.filter(n => !(n.kind === 'sermon' && isEmptySermon(n))).filter(n => !sermons || n.kind === 'sermon').filter(n => inCat(n, cat)).filter(n => !f || n.body.toLowerCase().includes(f) || (n.title ?? '').toLowerCase().includes(f)
      || (n.anchors ?? []).some(a => marks.get(a)?.quote.toLowerCase().includes(f))
      || n.refs.some(r => formatRef(r.s, r.e).toLowerCase().includes(f)))
    return order === 'recent' ? l.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : l.sort((a, b) => (a.refs[0]?.s ?? 9e9) - (b.refs[0]?.s ?? 9e9))
  }, [notes, cat, q, order, categories, sermons]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = cat === 'all' ? 'All notes' : cat === 'none' ? 'No category' : categoryPath(cat)
  const activeTop = categories.find(c => c.id === cat)?.parent ?? (tops.some(t => t.id === cat) ? cat : null)

  const rail = (
    <nav className="nb-rail" aria-label="Categories">
      <button className={cat === 'all' ? 'is-on' : ''} onClick={() => setCat('all')}>All notes<span>{notes.length}</span></button>
      {tops.map(t => (
        <div key={t.id}>
          <button className={cat === t.id ? 'is-on' : ''} onClick={() => setCat(t.id)}>{t.name}<span>{count(t.id)}</span></button>
          {categories.filter(c => c.parent === t.id).map(c => (
            <button key={c.id} className={`sub ${cat === c.id ? 'is-on' : ''}`} onClick={() => setCat(c.id)}>{c.name}<span>{count(c.id)}</span></button>
          ))}
        </div>
      ))}
      {categories.length > 0 && <button className={cat === 'none' ? 'is-on' : ''} onClick={() => setCat('none')}>No category<span>{count('none')}</span></button>}
      <a className="nb-manage" href="#/settings">{categories.length ? 'Edit categories' : 'Add categories'}</a>
    </nav>
  )

  return (
    <main className={`page notebook ${wide ? 'wide' : ''}`}>
      <header className="page-head nb-head">
        <div>
          <h1>Notebook</h1>
          <p>{notes.length ? `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}` : 'Select any words while reading, then choose Note.'}</p>
        </div>
        <div className="nb-btns">
          <button className="primary-btn small" onClick={async () => { const n = await createSermon(); go({ page: 'sermon', id: n._id }) }}>New sermon notes</button>
          <ScanButton />
        </div>
      </header>
      <div className="nb-layout">
        {wide ? rail : categories.length > 0 && (
          <div className="nb-chips">
            <button className={`chip-btn ${cat === 'all' ? 'is-on' : ''}`} onClick={() => setCat('all')}>All</button>
            {tops.map(t => <button key={t.id} className={`chip-btn ${activeTop === t.id ? 'is-on' : ''}`} onClick={() => setCat(t.id)}>{t.name}</button>)}
            <button className={`chip-btn ${cat === 'none' ? 'is-on' : ''}`} onClick={() => setCat('none')}>No category</button>
            {activeTop && categories.some(c => c.parent === activeTop) && (
              <div className="nb-subchips">
                {categories.filter(c => c.parent === activeTop).map(c => (
                  <button key={c.id} className={`chip-btn small ${cat === c.id ? 'is-on' : ''}`} onClick={() => setCat(cat === c.id ? activeTop : c.id)}>{c.name}</button>
                ))}
              </div>
            )}
          </div>
        )}
        <section className="nb-main">
          <div className="nb-tools">
            <div className="sp-search compact"><IconSearch size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${current.toLowerCase()}`} aria-label="Search notes" /></div>
            <button className={`chip-btn ${sermons ? 'is-on' : ''}`} onClick={() => setSermons(!sermons)} aria-pressed={sermons}>Sermons only</button>
            <div className="seg small">
              <button className={order === 'recent' ? 'is-on' : ''} onClick={() => setOrder('recent')}>Recent</button>
              <button className={order === 'bible' ? 'is-on' : ''} onClick={() => setOrder('bible')}>Bible order</button>
            </div>
          </div>
          <div className="nb-list">
            {list.map(n => <NoteCard key={n._id} note={n} />)}
            {!list.length && <p className="empty">{notes.length ? 'No notes here yet.' : 'Your notes will collect here.'}</p>}
          </div>
        </section>
      </div>
    </main>
  )
}

/* ---------- category manager (Settings) ---------- */
export function CategoryManager() {
  const { categories } = useStore()
  const [name, setName] = useState('')
  const [subFor, setSubFor] = useState<string | null>(null)
  const [subName, setSubName] = useState('')
  const tops = categories.filter(c => !c.parent)
  return (
    <section className="setting-group">
      <h2>Note categories</h2>
      <p className="hint">Group notes into categories, with subcategories underneath. You pick one when writing a note.</p>
      <ul className="cat-list">
        {tops.map(t => (
          <li key={t.id}>
            <CatRow c={t} onAddSub={() => { setSubFor(t.id); setSubName('') }} />
            <ul>
              {categories.filter(c => c.parent === t.id).map(c => <li key={c.id}><CatRow c={c} /></li>)}
              {subFor === t.id && (
                <li><form className="cat-add sub" onSubmit={async e => { e.preventDefault(); if (subName.trim()) { await addCategory(subName, t.id); setSubName('') } }}>
                  <input autoFocus className="field" value={subName} onChange={e => setSubName(e.target.value)} placeholder={`New subcategory in ${t.name}`} onBlur={() => !subName && setSubFor(null)} />
                  <button className="text-btn" type="submit">Add</button>
                </form></li>
              )}
            </ul>
          </li>
        ))}
      </ul>
      <form className="cat-add" onSubmit={async e => { e.preventDefault(); if (name.trim()) { await addCategory(name); setName('') } }}>
        <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="New category, e.g. Theology" aria-label="New category" />
        <button className="text-btn" type="submit" disabled={!name.trim()}>Add</button>
      </form>
    </section>
  )
}
function CatRow({ c, onAddSub }: { c: Category; onAddSub?: () => void }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(c.name)
  const { notes, categories } = getState()
  const n = notes.filter(x => x.category === c.id || categories.find(k => k.id === x.category)?.parent === c.id).length
  return (
    <div className={`cat-row ${c.parent ? 'sub' : ''}`}>
      {editing ? (
        <form className="cat-edit" onSubmit={async e => { e.preventDefault(); if (v.trim()) await renameCategory(c.id, v); setEditing(false) }}>
          <input autoFocus className="field" value={v} onChange={e => setV(e.target.value)} onBlur={async () => { if (v.trim() && v !== c.name) await renameCategory(c.id, v); setEditing(false) }} aria-label="Category name" />
        </form>
      ) : (
        <button className="cat-name" onClick={() => setEditing(true)} title="Rename">{c.name}<span className="muted">{n || ''}</span></button>
      )}
      {onAddSub && <button className="text-btn small" onClick={onAddSub}>Add subcategory</button>}
      <button className="icon-btn small" aria-label={`Delete ${c.name}`} title="Delete" onClick={() => {
        if (confirm(`Delete "${c.name}"${c.parent ? '' : ' and its subcategories'}? Notes in it keep their text and become uncategorized.`)) deleteCategory(c.id)
      }}><IconTrash size={15} /></button>
    </div>
  )
}

export { splitVid }
