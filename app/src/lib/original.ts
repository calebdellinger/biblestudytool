// Hebrew and Greek behind each verse: STEPBible tagged texts and brief lexicons (Tyndale House, CC BY 4.0).
import { splitVid } from './bible'

export type RawWord = [text: string, translit: string, gloss: string, strongs: string, morph: string]
export type WordPart = { text: string; gloss: string; strong: string; morph: string; main: boolean }
export type Word = {
  text: string; translit: string; gloss: string; glossMuted: boolean
  strong: string; morph: string; parts: WordPart[]; lang: 'hebrew' | 'greek'
}
export type LexEntry = { lemma: string; translit: string; gloss: string; def: string; count: number; verses: number[] }

const wordCache = new Map<number, Promise<Record<string, RawWord[]>>>()
export function loadWords(book: number) {
  if (!wordCache.has(book)) {
    wordCache.set(book, fetch(`/data/orig/words/${book}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})))
  }
  return wordCache.get(book)!
}

const stripPunct = (s: string) => s.split('\\')[0]
const mainOf = (strongs: string) => {
  const m = strongs.match(/\{([HG]\d+[A-Za-z]?)\}/) ?? strongs.match(/([HG]\d+[A-Za-z]?)/)
  return m ? normStrong(m[1]) : ''
}
export const normStrong = (s: string) => {
  const m = s.match(/([HG])(\d+)([A-Za-z]?)/)
  return m ? `${m[1]}${m[2].padStart(4, '0')}${m[3].toUpperCase()}` : s
}
/** "H7225G" → "H7225", the number people know from Strong's concordance. */
export const displayStrong = (s: string) => s.replace(/^([HG])0*(\d+).*$/, '$1$2')

export function parseWord(raw: RawWord, lang: 'hebrew' | 'greek'): Word {
  const [t, tr, gl, st, mo] = raw
  const text = stripPunct(t)
  const strongs = stripPunct(st)
  const main = mainOf(strongs)
  const textParts = text.split('/'), glossParts = gl.split('/'), strongParts = strongs.split('/'), morphParts = mo.split('/')
  const prefix = mo[0] === 'A' ? 'A' : 'H'
  const parts: WordPart[] = lang === 'hebrew'
    ? textParts.map((p, i) => {
        const s = (strongParts[i] ?? '').replace(/[{}]/g, '')
        return {
          text: p, gloss: (glossParts[i] ?? '').trim(), strong: normStrong(s),
          morph: i === 0 ? morphParts[0] : prefix + (morphParts[i] ?? ''), main: normStrong(s) === main,
        }
      })
    : [{ text, gloss: gl, strong: main, morph: mo, main: true }]
  const gloss = gl.replace(/\//g, ' ').replace(/\s+/g, ' ').trim()
  return {
    text: text.replace(/\//g, ''),
    translit: tr.replace(/[./]/g, '').toLowerCase(),
    gloss: gloss.replace(/[<>]/g, ''), glossMuted: /^<.*>$/.test(gloss),
    strong: main, morph: parts.find(p => p.main)?.morph ?? mo, parts, lang,
  }
}

export async function wordsFor(id: number): Promise<Word[]> {
  const { b, c, v } = splitVid(id)
  const raw = (await loadWords(b))[`${c}:${v}`] ?? []
  const lang = b <= 39 ? 'hebrew' : 'greek'
  return raw.map(w => parseWord(w, lang))
}

const lexCache = new Map<string, Promise<Record<string, [string, string, string, string, number, number[]]>>>()
export async function lexEntry(strong: string): Promise<LexEntry | null> {
  const s = normStrong(strong)
  const bucket = s[0] + Math.floor(Number(s.slice(1, 5)) / 100)
  if (!lexCache.has(bucket)) {
    lexCache.set(bucket, fetch(`/data/orig/lex/${bucket}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})))
  }
  const all = await lexCache.get(bucket)!
  const e = all[s] ?? all[s.replace(/[A-Z]$/, '')] ?? Object.entries(all).find(([k]) => k.startsWith(s.slice(0, 5)))?.[1]
  if (!e) return null
  return { lemma: e[0], translit: e[1], gloss: e[2], def: sanitize(e[3]), count: e[4], verses: e[5] }
}

/** Keep only <b>, <i> and <br> from lexicon text. */
function sanitize(html: string) {
  const esc = (s: string) => s.replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return html.split(/(<\/?(?:b|i)>|<br>)/i).map((p, i) => (i % 2 ? p : esc(p))).join('')
}

let morphPromise: Promise<Record<string, string>> | null = null
/** "HVqp3ms" → [["Verb"], ["Stem", "Qal"], ["Form", "Perfect"], ...] for display. */
export async function describeMorph(code: string): Promise<{ summary: string; rows: [string, string][] }> {
  morphPromise ??= fetch('/data/orig/morph.json').then(r => r.json()).catch(() => ({}))
  const m = (await morphPromise)[code]
  if (!m) return { summary: code, rows: [] }
  const rows: [string, string][] = m.replace(/\s*\(hence[^)]*\)/g, '').split(';').map(x => x.trim()).filter(Boolean)
    .map(x => { const [k, ...v] = x.split('='); return [k.trim(), v.join('=').trim()] as [string, string] })
    .filter(([k, v]) => k && v)
  const summary = rows.map(([, v]) => v).join(', ')
  return { summary, rows }
}

/* ---------- concordance: every place a word is used (data/orig/conc, built by scripts/build_concordance.py) ---------- */
export type Concordance = { forms: string[]; glosses: string[]; occ: [verse: number, form: number, gloss: number][] }
const concCache = new Map<string, Promise<Record<string, { f: string[]; g: string[]; o: [number, number, number][] }>>>()
export async function concordance(strong: string): Promise<{ key: string; c: Concordance } | null> {
  const s = normStrong(strong)
  const bucket = s[0] + Math.floor(Number(s.slice(1, 5)) / 100)
  if (!concCache.has(bucket)) concCache.set(bucket, fetch(`/data/orig/conc/${bucket}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})))
  const all = await concCache.get(bucket)!
  const key = all[s] ? s : all[s.replace(/[A-Z]$/, '')] ? s.replace(/[A-Z]$/, '') : Object.keys(all).find(k => k.startsWith(s.slice(0, 5)))
  if (!key) return null
  const e = all[key]
  return { key, c: { forms: e.f, glosses: e.g, occ: e.o } }
}
