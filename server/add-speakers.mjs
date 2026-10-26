// Adds Gemini's "who's speaking" files to the app. No other tools needed, just Node.
// Reads for-gemini/results/*.jsonl, checks every line against the Berean Standard Bible text,
// writes app/dist/data/speakers/BSB/<book>.json (live at once) and app/public/data/speakers/BSB/ (kept for rebuilds),
// and saves a report to for-gemini/results/REPORT.txt.
// Same rules as scripts/build_speakers.py: words must be found in the verse; quotes inside quotes stay with the outer
// speaker; "low" confidence lines are left uncoloured.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RESULTS = path.join(ROOT, 'for-gemini', 'results')
const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/public/data/books.json'), 'utf8'))
// Accept the book code from the prompt files (EXOD), the full name (Exodus, 1 Samuel) or the abbreviation (Exod).
const key = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '')
const byCode = new Map(books.flatMap(b => [[key(b.osis), b], [key(b.name), b], [key(b.abbr), b]]))
for (const [alias, code] of [['JOS', 'JOSH'], ['JHN', 'JOHN'], ['JON', 'JONAH'], ['RUT', 'RUTH'], ['EXO', 'EXOD'], ['MAT', 'MATT'], ['MRK', 'MARK'], ['LUK', 'LUKE'], ['ACT', 'ACTS'], ['DEU', 'DEUT'], ['NUM', 'NUM'], ['PSA', 'PS'], ['PRO', 'PROV'], ['ISA', 'ISA'], ['JER', 'JER'], ['EZK', 'EZEK'], ['REV', 'REV']])
  if (byCode.has(code) && !byCode.has(alias)) byCode.set(alias, byCode.get(code))
const norm = s => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, '-')
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function find(text, needle, occurrence = 1, near = null) {
  for (const [hay, n] of [[text, needle], [norm(text), norm(needle)]]) {
    if (!n) return null
    const hits = [...hay.matchAll(new RegExp(esc(n), 'g'))].map(m => m.index)
    if (!hits.length) continue
    let h
    if (near != null) { const before = hits.filter(x => x <= near); h = before.length ? before[before.length - 1] : hits[0] }
    else h = hits[Math.min(occurrence, hits.length) - 1]
    return [h, h + n.length]
  }
  return null
}

const report = []
const outDirs = ['app/dist/data/speakers/BSB', 'app/public/data/speakers/BSB'].map(d => path.join(ROOT, d))
outDirs.forEach(d => fs.mkdirSync(d, { recursive: true }))
const index = new Set(fs.existsSync(path.join(outDirs[0], 'index.json')) ? JSON.parse(fs.readFileSync(path.join(outDirs[0], 'index.json'), 'utf8')) : [])
const files = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).filter(f => /\.(jsonl|txt|json)$/i.test(f) && f !== 'REPORT.txt') : []
if (!files.length) report.push(`No files found in ${RESULTS}`)

// Group lines by book, whatever file they came in (a file may hold several books).
const byBook = new Map()
for (const f of files) {
  fs.readFileSync(path.join(RESULTS, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    line = line.trim().replace(/^```\w*|```$/g, '').trim()
    if (!line.startsWith('{')) return
    let r
    try { r = JSON.parse(line) } catch (e) { report.push(`${f} line ${i + 1}: not valid JSON`); return }
    if (r.continue_from || !r.ref) return
    const code = key(String(r.ref).replace(/\s*\d+:\d+.*$/, ''))
    const book = byCode.get(code)
    if (!book) { report.push(`${f} line ${i + 1}: unknown book code ${code}`); return }
    if (!byBook.has(book.id)) byBook.set(book.id, [])
    byBook.get(book.id).push([`${f}:${i + 1}`, r])
  })
}

for (const [bid, rows] of byBook) {
  const book = books.find(b => b.id === bid)
  const text = JSON.parse(fs.readFileSync(path.join(ROOT, `app/public/data/bible/BSB/${bid}.json`), 'utf8'))
  const names = new Map(), chapters = new Map()
  let used = 0, bad = 0
  for (const [where, r] of rows) {
    const m = String(r.ref).match(/(\d+):(\d+)/)
    const verse = m && text[+m[1] - 1]?.[+m[2] - 1]
    if (!verse) { report.push(`${r.ref}: no such verse (${where})`); bad++; continue }
    const c = +m[1], v = +m[2]
    if (r.name && !names.has(r.speaker)) names.set(r.speaker, r.name)
    if (r.nested_in || r.confidence === 'low') continue
    const span = find(verse, r.text ?? '', r.occurrence ?? 1)
    if (!span) { report.push(`${r.ref}: words not found in the verse: "${String(r.text).slice(0, 70)}"`); bad++; continue }
    if (!chapters.has(c)) chapters.set(c, { people: [], v: {} })
    const ch = chapters.get(c)
    if (!ch.people.includes(r.speaker)) ch.people.push(r.speaker)
    const k = ch.people.indexOf(r.speaker)
    ;(ch.v[v] ??= []).push([span[0], span[1], k, 0])
    if (r.tag) {
      const t = find(verse, r.tag, 1, span[0])
      if (t && !(t[0] < span[1] && span[0] < t[1])) ch.v[v].push([t[0], t[1], k, 1])
      else if (!t) report.push(`${r.ref}: naming words not found: "${r.tag}"`)
    }
    used++
  }
  // Quotations in the Bible text that nobody was given (skipped verses or chapters).
  let missing = 0
  text.forEach((chv, ci) => chv.forEach((verse, vi) => {
    if (!/“/.test(verse)) return
    const spans = chapters.get(ci + 1)?.v[vi + 1] ?? []
    if (!spans.some(s => s[3] === 0)) { missing++; if (missing <= 40) report.push(`${book.name} ${ci + 1}:${vi + 1}: has a quotation but no speaker`) }
  }))
  if (missing > 40) report.push(`${book.name}: ... and ${missing - 40} more verses with quotations but no speaker`)
  const out = {}
  for (const [c, ch] of [...chapters].sort((a, b) => a[0] - b[0])) {
    const vs = {}
    for (const [v, spans] of Object.entries(ch.v)) vs[v] = [...new Map(spans.map(s => [s.join(','), s])).values()].sort((a, b) => a[0] - b[0])
    out[c] = { people: ch.people.map(id => [id, names.get(id) ?? id.replace(/-/g, ' ').replace(/\b\w/g, x => x.toUpperCase())]), v: vs }
  }
  for (const d of outDirs) fs.writeFileSync(path.join(d, `${bid}.json`), JSON.stringify(out))
  index.add(bid)
  report.unshift(`${book.name}: ${used} lines added, ${bad} rejected, ${missing} verses with a quotation but no speaker`)
}
for (const d of outDirs) fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify([...index].sort((a, b) => a - b)))
const summary = report.join('\r\n')
fs.writeFileSync(path.join(RESULTS, 'REPORT.txt'), summary + '\r\n')
console.log(summary)
console.log(`\nDone. Reload the app to see the colours. This report is saved in for-gemini\\results\\REPORT.txt`)
