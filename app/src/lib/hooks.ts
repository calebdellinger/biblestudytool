import { useEffect, useState, useSyncExternalStore } from 'react'
import { getState, subscribe, getSync, subscribeSync } from './db'

export const useStore = () => useSyncExternalStore(subscribe, getState)
export const useSync = () => {
  const [, force] = useState(0)
  useEffect(() => subscribeSync(() => force(n => n + 1)), [])
  return getSync()
}

/** Async value with loading state; re-runs when deps change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): T | undefined {
  const [val, setVal] = useState<T>()
  useEffect(() => {
    let live = true
    setVal(undefined)
    fn().then(v => { if (live) setVal(v) }).catch(() => { if (live) setVal(undefined) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return val
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

// ---- tiny hash router: #/read/45/8/28?scope=chapter · #/notes · #/settings ------------------
export type Route =
  | { page: 'read'; book: number; chapter: number; verse: number | null; scope: 'verse' | 'chapter' | 'book' }
  | { page: 'notes' } | { page: 'sermon'; id: string } | { page: 'settings' } | { page: 'search'; q: string }
  | { page: 'map'; verse: number }
  | { page: 'person'; n: number }
  | { page: 'memory' } | { page: 'today' } | { page: 'reading' } | { page: 'word'; strong: string; from?: number } | { page: 'lessons' } | { page: 'lesson'; id: string; mode?: 'present' | 'handout'; at?: string }
  | { page: 'paper'; date: string; edition: 'full' | 'split' } | { page: 'practice'; id?: string } | { page: 'memrecord' }
  | { page: 'spurgeon'; view: 'home' | 'sermon' | 'psalm' | 'search' | 'work'; id?: string; q?: string; author?: string }

export function parseHash(h = location.hash): Route | null {
  const [path, query] = h.replace(/^#\/?/, '').split('?')
  const p = path.split('/')
  const qs = new URLSearchParams(query ?? '')
  if (p[0] === 'read' && p[1]) {
    const scope = (qs.get('scope') as 'verse' | 'chapter' | 'book') ?? 'chapter'
    return { page: 'read', book: +p[1], chapter: +(p[2] || 1), verse: p[3] ? +p[3] : null, scope }
  }
  if (p[0] === 'notes') return { page: 'notes' }
  if (p[0] === 'sermon' && p[1]) return { page: 'sermon', id: decodeURIComponent(p[1]) }
  if (p[0] === 'today') return { page: 'today' }
  if (p[0] === 'reading') return { page: 'reading' }
  if (p[0] === 'paper' && p[1]) return { page: 'paper', date: p[1], edition: p[2] === 'split' ? 'split' : 'full' }
  if (p[0] === 'memory' && p[1] === 'record') return { page: 'memrecord' }
  if (p[0] === 'memory') return p[1] === 'practice' ? { page: 'practice', id: p[2] ? decodeURIComponent(p[2]) : undefined } : { page: 'memory' }
  if (p[0] === 'settings') return { page: 'settings' }
  if (p[0] === 'search') return { page: 'search', q: qs.get('q') ?? '' }
  if (p[0] === 'map' && p[1]) return { page: 'map', verse: Number(p[1]) }
  if (p[0] === 'person' && p[1]) return { page: 'person', n: Number(p[1]) }
  if (p[0] === 'lessons') return p[1] ? { page: 'lesson', id: decodeURIComponent(p[1]), mode: p[2] === 'present' || p[2] === 'handout' ? p[2] : undefined, at: qs.get('at') ?? undefined } : { page: 'lessons' }
  if (p[0] === 'word' && p[1]) return { page: 'word', strong: decodeURIComponent(p[1]), from: qs.get('from') ? Number(qs.get('from')) : undefined }
  if (p[0] === 'spurgeon') {
    if (p[1] === 'sermon' && p[2]) return { page: 'spurgeon', view: 'sermon', id: decodeURIComponent(p[2]) }
    if (p[1] === 'psalm' && p[2]) return { page: 'spurgeon', view: 'psalm', id: p[2] }
    if (p[1] === 'search') return { page: 'spurgeon', view: 'search', q: qs.get('q') ?? '' }
    if (p[1] === 'work' && p[2]) return { page: 'spurgeon', view: 'work', id: p.slice(2).map(decodeURIComponent).join('/') }
    return { page: 'spurgeon', view: 'home', author: p[1] || undefined }
  }
  return null
}
export function href(r: Route): string {
  if (r.page === 'read') {
    const scope = r.scope === 'chapter' ? '' : `?scope=${r.scope}`
    return `#/read/${r.book}/${r.chapter}${r.verse ? `/${r.verse}` : ''}${scope}`
  }
  if (r.page === 'sermon') return `#/sermon/${encodeURIComponent(r.id)}`
  if (r.page === 'search') return `#/search?q=${encodeURIComponent(r.q)}`
  if (r.page === 'map') return `#/map/${r.verse}`
  if (r.page === 'person') return `#/person/${r.n}`
  if (r.page === 'lesson') return `#/lessons/${encodeURIComponent(r.id)}${r.mode ? `/${r.mode}` : ''}${r.at ? `?at=${r.at}` : ''}`
  if (r.page === 'word') return `#/word/${encodeURIComponent(r.strong)}${r.from ? `?from=${r.from}` : ''}`
  if (r.page === 'paper') return `#/paper/${r.date}/${r.edition}`
  if (r.page === 'memrecord') return '#/memory/record'
  if (r.page === 'practice') return `#/memory/practice${r.id ? `/${encodeURIComponent(r.id)}` : ''}`
  if (r.page === 'spurgeon') {
    if (r.view === 'sermon' || r.view === 'psalm') return `#/spurgeon/${r.view}/${encodeURIComponent(r.id ?? '')}`
    if (r.view === 'search') return `#/spurgeon/search?q=${encodeURIComponent(r.q ?? '')}`
    if (r.view === 'work') return `#/spurgeon/work/${(r.id ?? '').split('/').map(encodeURIComponent).join('/')}`
    return r.author ? `#/spurgeon/${r.author}` : '#/spurgeon'
  }
  return `#/${r.page}`
}
export const go = (r: Route, replace = false) => {
  const h = href(r)
  if (replace) history.replaceState(history.state, '', h); else location.hash = h
  if (replace) dispatchEvent(new HashChangeEvent('hashchange'))
}
// ---- in-app back button: count how many pages deep you are in this visit ----------------
// Each new page gets a depth in history.state; going back restores the earlier page's depth.
let depth = (history.state as { depth?: number } | null)?.depth ?? 0
if (history.state?.depth == null) history.replaceState({ ...(history.state ?? {}), depth }, '')
const depthSubs = new Set<() => void>()
addEventListener('hashchange', () => {
  const d = (history.state as { depth?: number } | null)?.depth
  if (d == null) { depth += 1; history.replaceState({ ...(history.state ?? {}), depth }, '') } else depth = d
  depthSubs.forEach(f => f())
})
export const useCanGoBack = () => useSyncExternalStore(fn => (depthSubs.add(fn), () => { depthSubs.delete(fn) }), () => depth > 0)

export function useRoute(fallback: Route): Route {
  const [r, setR] = useState<Route>(() => parseHash() ?? fallback)
  useEffect(() => {
    const on = () => setR(parseHash() ?? fallback)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [fallback])
  return r
}

// ---- preferences (per device) ------------------------------------------------------------
export type Prefs = { translation: 'BSB' | 'KJV' | 'NIV' | 'NLT' | 'NASB'; textSize: number; theme: 'system' | 'light' | 'dark'; style: 'classic' | 'parchment' | 'modern' | 'neon'; redLetter: boolean; speakers: boolean; layout: 'flow' | 'lines'; interlinear: boolean }
const PREF_KEY = 'margin.prefs'
const defaults: Prefs = { translation: 'BSB', textSize: 20, theme: 'system', style: 'classic', redLetter: true, speakers: true, layout: 'flow', interlinear: false }
let prefs: Prefs = (() => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') } } catch { return defaults }
})()
const prefListeners = new Set<() => void>()
export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p }
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
  prefListeners.forEach(f => f())
}
export const usePrefs = () =>
  useSyncExternalStore(fn => (prefListeners.add(fn), () => { prefListeners.delete(fn) }), () => prefs)
