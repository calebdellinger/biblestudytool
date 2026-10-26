// Index every Bible reference in the Theologians library (Murray, Bounds, Moody) by verse,
// so the reader can show "what the theologians say about this verse".
// Output: app/public/data/theologians/refs/<book id>.json = [[start, end, workId, chapter, snippet], ...]
// Run after build_theologians.py:  node scripts/build_theologians_refs.mjs
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const pkg = path.join(root, 'app/node_modules/bible-passage-reference-parser/esm')
const { bcv_parser } = await import(path.join(pkg, 'bcv_parser.js'))
const lang = await import(path.join(pkg, 'lang/en.js'))
const books = JSON.parse(fs.readFileSync(path.join(root, 'app/public/data/books.json'), 'utf8'))
const byOsis = new Map(books.map(b => [b.osis, b]))
const p = new bcv_parser(lang)
p.set_options({ osis_compaction_strategy: 'bcv', book_alone_strategy: 'ignore', book_sequence_strategy: 'ignore', invalid_passage_strategy: 'ignore', invalid_sequence_strategy: 'ignore' })
const id = (b, c, v) => b * 1_000_000 + c * 1000 + v

// Quotations without a reference: match them against the King James text they quote.
const words = t => t.toLowerCase().replace(/[’']/g, '').match(/[a-z]+/g) ?? []
const shingles = ws => { const r = []; for (let i = 0; i + 5 <= ws.length; i++) r.push(ws.slice(i, i + 5).join(' ')); return r }
const kjv = new Map()  // 5-word phrase -> verse ids
for (const b of books) {
  const f = path.join(root, `app/public/data/bible/KJV/${b.id}.json`)
  if (!fs.existsSync(f)) continue
  JSON.parse(fs.readFileSync(f, 'utf8')).forEach((ch, ci) => ch.forEach((v, vi) => {
    for (const sh of new Set(shingles(words(v)))) { const l = kjv.get(sh) ?? []; if (l.length < 6) l.push(id(b.id, ci + 1, vi + 1)); kjv.set(sh, l) }
  }))
}
function matchQuote(q) {
  const sh = shingles(words(q))
  if (sh.length < 3) return null
  const votes = new Map()
  for (const x of sh) { const l = kjv.get(x); if (!l || l.length > 3) continue; for (const v of l) votes.set(v, (votes.get(v) ?? 0) + 1) }
  let best = 0, bestV = 0
  for (const [v, n] of votes) if (n > best) { best = n; bestV = v }
  if (best < Math.max(2, sh.length * 0.5) && best < 6) return null
  let s = bestV, e = bestV
  while ((votes.get(s - 1) ?? 0) >= 2) s--
  while ((votes.get(e + 1) ?? 0) >= 2) e++
  return [s, e]
}
const bookOf = v => Math.floor(v / 1_000_000)
let quoted = 0

const dir = path.join(root, 'app/public/data/theologians')
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))
const out = new Map()  // book id -> rows
let total = 0
const plain = s => s.replace(/[*_>#]/g, '').replace(/\s+/g, ' ').trim()
function snippetAround(para, at, len) {
  // The sentence or two around the reference, trimmed to about 260 characters.
  const t = plain(para)
  if (t.length <= 280) return t
  const pos = Math.min(t.length, Math.max(0, Math.round(at * t.length / Math.max(1, para.length))))
  let a = Math.max(0, pos - 180), z = Math.min(t.length, pos + len + 80)
  const startSentence = t.lastIndexOf('. ', a + 60)
  if (startSentence > 0 && startSentence > a - 80) a = startSentence + 2
  return (a > 0 ? '…' : '') + t.slice(a, z).trim() + (z < t.length ? '…' : '')
}

for (const a of index.authors) for (const w of a.works) for (const [n] of w.chapters) {
  const md = fs.readFileSync(path.join(dir, 'works', w.id, `${n}.md`), 'utf8')
  const seen = new Set()
  for (const para of md.split(/\n\n+/)) {
    if (para.startsWith('## ')) continue
    for (const hit of p.parse(para).parsed_entities()) {
      for (const ent of hit.entities) {
        const [s, e = s] = ent.osis.split('-')
        const f = x => { const [bk, c, v] = x.split('.'); const b = byOsis.get(bk); return b && c ? [b, +c, v ? +v : null] : null }
        const A = f(s), Z = f(e)
        if (!A || !Z || A[0] !== Z[0]) continue
        // Whole-chapter references only count when short ("Psalm 23"), not "Isaiah 40-66".
        if (A[2] === null && Z[1] - A[1] > 1) continue
        const start = id(A[0].id, A[1], A[2] ?? 1), end = id(Z[0].id, Z[1], Z[2] ?? (A[0].verses?.[Z[1] - 1] ?? 999))
        const key = `${start}-${end}`
        if (seen.has(key)) continue
        seen.add(key)
        const rows = out.get(A[0].id) ?? []
        rows.push([start, end, w.id, n, snippetAround(para, hit.indices[0], hit.indices[1] - hit.indices[0])])
        out.set(A[0].id, rows); total++
      }
    }
    for (const m of para.matchAll(/[“"]([^”"]{30,600})[”"]/g)) {
      const r = matchQuote(m[1])
      if (!r) continue
      const key = `${r[0]}-${r[1]}`
      if (seen.has(key) || [...seen].some(k => { const [a, z] = k.split('-').map(Number); return a <= r[0] && r[1] <= z && z - a < 30 })) continue
      seen.add(key)
      const rows = out.get(bookOf(r[0])) ?? []
      rows.push([r[0], r[1], w.id, n, snippetAround(para, m.index, m[0].length)])
      out.set(bookOf(r[0]), rows); total++; quoted++
    }
  }
}
fs.rmSync(path.join(dir, 'refs'), { recursive: true, force: true })
fs.mkdirSync(path.join(dir, 'refs'), { recursive: true })
for (const [b, rows] of out) {
  rows.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  fs.writeFileSync(path.join(dir, 'refs', `${b}.json`), JSON.stringify(rows))
}
console.log(`${total} references (${quoted} found by matching quotations) across ${out.size} books`)
