import { useEffect, useState } from 'react'
import { books, formatRef, loadBook, loadBooks, localTr, splitVid, TRANSLATIONS, vid, type Translation } from '../lib/bible'
import { deviceKey, setDeviceKey } from '../lib/apiBible'
import {
  exportAll, loadSyncSettings, saveSyncSettings, startSync, testSync, type SyncSettings,
} from '../lib/db'
import { go, setPrefs, usePrefs, useSync } from '../lib/hooks'
import { CategoryManager } from './Notes'
import { DailySettings } from './Today'
import { OfflineLibrary } from './OfflineLibrary'

export function SearchPage({ q }: { q: string }) {
  const prefs = usePrefs()
  const [results, setResults] = useState<{ id: number; text: string }[] | null>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let live = true
    setResults(null); setProgress(0)
    ;(async () => {
      await loadBooks()
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      const found: { id: number; text: string }[] = []
      for (const b of books()) {
        const chapters = await loadBook(prefs.translation as Translation, b.id)
        if (!live) return
        setProgress(b.id)
        chapters.forEach((vs, ci) => vs.forEach((t, vi) => {
          const low = t.toLowerCase()
          if (words.every(w => low.includes(w))) found.push({ id: vid(b.id, ci + 1, vi + 1), text: t })
        }))
      }
      if (live) setResults(found)
    })()
    return () => { live = false }
  }, [q, prefs.translation])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const mark = (t: string) => {
    if (!words.length) return t
    const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
    return t.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
  }

  return (
    <main className="page">
      <header className="page-head">
        <h1>“{q}”</h1>
        <p>{results ? `${results.length.toLocaleString()} ${results.length === 1 ? 'verse' : 'verses'} in the ${localTr(prefs.translation)}${localTr(prefs.translation) !== prefs.translation ? ` (search can't look inside the ${prefs.translation})` : ''}` : `Searching… ${Math.round((progress / 66) * 100)}%`}</p>
      </header>
      <ol className="search-results">
        {results?.slice(0, 400).map(r => {
          const { b, c, v } = splitVid(r.id)
          return (
            <li key={r.id}>
              <button className="result" onClick={() => go({ page: 'read', book: b, chapter: c, verse: v, scope: 'chapter' })}>
                <span className="result-ref">{formatRef(r.id, r.id, true)}</span>
                <span className="result-text">{mark(r.text)}</span>
              </button>
            </li>
          )
        })}
      </ol>
      {results && results.length > 400 && <p className="muted">Showing the first 400. Add another word to narrow it down.</p>}
    </main>
  )
}

export function SettingsPage() {
  const prefs = usePrefs()
  const sync = useSync()
  const [s, setS] = useState<SyncSettings>(loadSyncSettings)
  const [test, setTest] = useState<string | null>(null)

  const syncText = {
    off: 'Sync is off. Everything is saved on this device.',
    connecting: 'Connecting to your PC…',
    synced: `Synced with your PC${sync.lastSynced ? ` at ${new Date(sync.lastSynced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.`,
    syncing: 'Syncing…',
    offline: 'Your PC is out of reach. Changes are saved here and will sync when it\'s back.',
    error: sync.error || 'Sync stopped with an error.',
  }[sync.status]

  async function onTest() {
    setTest('Checking…')
    const err = await testSync(s)
    setTest(err ?? 'Connected. Your PC is reachable and the login works.')
  }
  function onSave(enabled = s.enabled) {
    const next = { ...s, enabled }
    setS(next); saveSyncSettings(next); startSync(next)
  }
  async function onExport() {
    const blob = await exportAll()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `margin-notes-${new Date().toISOString().slice(0, 10)}.json`
    a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <main className="page settings">
      <header className="page-head"><h1>Settings</h1></header>

      <section className="setting-group">
        <h2>Reading</h2>
        <div className="setting">
          <label htmlFor="tr">Translation</label>
          <select id="tr" className="field" value={prefs.translation} onChange={e => setPrefs({ translation: e.target.value as Translation })}>
            <optgroup label="On this device">{TRANSLATIONS.filter(t => !t.online).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
            <optgroup label="Online, from API.Bible">{TRANSLATIONS.filter(t => t.online).map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}</optgroup>
          </select>
        </div>
        <ApiBibleKey />
        <div className="setting">
          <label htmlFor="size">Text size</label>
          <div className="range-row">
            <input id="size" type="range" min={16} max={28} step={1} value={prefs.textSize} onChange={e => setPrefs({ textSize: +e.target.value })} />
            <span className="sample" style={{ fontSize: prefs.textSize }}>Aa</span>
          </div>
        </div>
        <div className="setting">
          <span className="label">Verses</span>
          <div className="seg">
            <button className={prefs.layout === 'flow' ? 'is-on' : ''} onClick={() => setPrefs({ layout: 'flow' })}>As paragraphs</button>
            <button className={prefs.layout === 'lines' ? 'is-on' : ''} onClick={() => setPrefs({ layout: 'lines' })}>One per line</button>
          </div>
        </div>
        <div className="setting">
          <span className="label">Style</span>
          <div className="seg">
            <button className={prefs.style === 'parchment' ? 'is-on' : ''} onClick={() => setPrefs({ style: 'parchment' })}>Parchment</button>
            <button className={prefs.style !== 'parchment' && prefs.style !== 'modern' && prefs.style !== 'neon' ? 'is-on' : ''} onClick={() => setPrefs({ style: 'classic' })}>Classic</button>
            <button className={prefs.style === 'modern' ? 'is-on' : ''} onClick={() => setPrefs({ style: 'modern' })}>Modern</button>
            <button className={prefs.style === 'neon' ? 'is-on' : ''} onClick={() => setPrefs({ style: 'neon' })}>Neon</button>
          </div>
          {prefs.style === 'neon' && <p className="hint small">Neon is always dark: neon colours wash out on a light page. On iPhone, iPad and Mac it uses their wider, more vivid colour range.</p>}
        </div>
        <div className="setting">
          <span className="label">Who's speaking</span>
          <div className="seg">
            <button className={prefs.speakers !== false ? 'is-on' : ''} onClick={() => setPrefs({ speakers: true })}>Colour</button>
            <button className={prefs.speakers === false ? 'is-on' : ''} onClick={() => setPrefs({ speakers: false })}>Off</button>
          </div>
          <p className="hint small">In the Berean Standard Bible, each speaker's words are tinted and their name picked out. Tap Speakers above the text to switch it on or off.</p>
        </div>
        <div className="setting">
          <span className="label">Words of Jesus</span>
          <div className="seg">
            <button className={prefs.redLetter !== false ? 'is-on' : ''} onClick={() => setPrefs({ redLetter: true })}>In red</button>
            <button className={prefs.redLetter === false ? 'is-on' : ''} onClick={() => setPrefs({ redLetter: false })}>Plain</button>
          </div>
        </div>
        <div className="setting">
          <span className="label">Light or dark</span>
          <div className="seg">
            {(['system', 'light', 'dark'] as const).map(t => (
              <button key={t} className={prefs.theme === t ? 'is-on' : ''} onClick={() => setPrefs({ theme: t })}>
                {t === 'system' ? 'Match device' : t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <DailySettings />

      <CategoryManager />

      <section className="setting-group">
        <h2>Sync with your PC</h2>
        <p className={`sync-status sync-${sync.status}`}><span className={`sync-dot sync-${sync.status}`} />{syncText}</p>
        <div className="setting">
          <label htmlFor="url">Server address</label>
          <input id="url" className="field" value={s.url} onChange={e => setS({ ...s, url: e.target.value })} spellCheck={false} autoCapitalize="off" />
        </div>
        <div className="setting two">
          <div>
            <label htmlFor="user">Username</label>
            <input id="user" className="field" value={s.user} onChange={e => setS({ ...s, user: e.target.value })} autoCapitalize="off" autoComplete="username" />
          </div>
          <div>
            <label htmlFor="pw">Password</label>
            <input id="pw" className="field" type="password" value={s.password} onChange={e => setS({ ...s, password: e.target.value })} autoComplete="current-password" />
          </div>
        </div>
        {test && <p className="hint">{test}</p>}
        <div className="button-row">
          <button className="text-btn" onClick={onTest}>Test connection</button>
          {s.enabled
            ? <><button className="text-btn" onClick={() => onSave(true)}>Save changes</button><button className="text-btn danger" onClick={() => onSave(false)}>Turn off sync</button></>
            : <button className="primary-btn" onClick={() => onSave(true)}>Turn on sync</button>}
        </div>
      </section>

      <OfflineLibrary />

      <section className="setting-group">
        <h2>Your data</h2>
        <p className="hint">Download every note and highlight as a file. Your PC also backs everything up nightly once it's set up.</p>
        <div className="button-row"><button className="text-btn" onClick={onExport}>Download a copy</button></div>
      </section>

      <footer className="credits">
        <p>Version {__BUILD__}</p>
        <p>Berean Standard Bible text is public domain. Cross-references from OpenBible.info (CC BY). Translations and data via scrollmapper/bible_databases.</p>
      </footer>
    </main>
  )
}

/** The API.Bible key on this device, so the NIV, NLT and NASB work without your PC. Kept on this device only. */
function ApiBibleKey() {
  const [key, setKey] = useState(deviceKey)
  const [state, setState] = useState<string | null>(null)
  const saved = deviceKey()
  const test = async (k: string) => {
    setState('Checking…')
    try {
      const r = await fetch('https://rest.api.bible/v1/bibles/78a9f6124f344018-01', { headers: { 'api-key': k }, signal: AbortSignal.timeout(10_000) })
      setState(r.ok ? 'Saved. The NIV, NLT and NASB now work on this device even when your PC is off.' : r.status === 401 || r.status === 403 ? 'API.Bible didn\'t accept that key.' : `API.Bible answered ${r.status}.`)
      if (r.ok) setDeviceKey(k)
    } catch { setState('Couldn\'t reach API.Bible. Check your connection and try again.') }
  }
  return (
    <div className="setting setting-col">
      <span className="label">Online translations</span>
      <p className="hint small">The NIV, NLT and NASB are read from API.Bible a chapter at a time (their publishers don't allow a full download). The last few chapters you read stay available offline for up to two weeks. Search, word study, cross-references, lessons and the newspaper use the BSB when one of these is chosen.</p>
      <p className="hint small">{saved ? 'This device has its own API.Bible key, so these work anywhere you have internet.' : 'Right now they come through your PC. To read them with the PC off, paste your API.Bible key below. It stays on this device only and is never synced.'}</p>
      <form className="mem-add" onSubmit={e => { e.preventDefault(); if (key.trim()) test(key.trim()) }}>
        <input className="field" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="API.Bible key" aria-label="API.Bible key" />
        <button className="primary-btn" type="submit">Save</button>
        {saved && <button className="text-btn" type="button" onClick={() => { setDeviceKey(''); setKey(''); setState('Removed from this device.') }}>Remove</button>}
      </form>
      {state && <p className="hint small" role="status">{state}</p>}
    </div>
  )
}
