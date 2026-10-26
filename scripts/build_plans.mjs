// Robert Murray M'Cheyne's Bible reading calendar (1842, public domain): four readings a day,
// the New Testament and Psalms twice and the rest of the Bible once in a year.
// Source list: github.com/mgyarmathy/bible-in-one-year (Unlicense), saved in scripts/data/mcheyne-source.json.
// Run:  node scripts/build_plans.mjs   (after npm install in app/)
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const pkg = path.join(root, 'app/node_modules/bible-passage-reference-parser/esm')
const { bcv_parser } = await import(path.join(pkg, 'bcv_parser.js'))
const lang = await import(path.join(pkg, 'lang/en.js'))
const books = JSON.parse(fs.readFileSync(path.join(root, 'app/public/data/books.json'), 'utf8'))
const byOsis = new Map(books.map(b => [b.osis, b]))
const p = new bcv_parser(lang)
p.set_options({ osis_compaction_strategy: 'bcv', consecutive_combination_strategy: 'combine', book_alone_strategy: 'full' })
const id = (b, c, v) => b * 1_000_000 + c * 1000 + v
function ranges(text) {
  const osis = p.parse(text).osis()
  return osis.split(',').filter(Boolean).map(part => {
    const [a, z = a] = part.split('-')
    const f = s => { const [bk, c, v] = s.split('.'); const b = byOsis.get(bk); if (!b) throw new Error(`book ${bk} in ${text}`); return [b, +c, v ? +v : null] }
    const [b1, c1, v1] = f(a), [b2, c2, v2] = f(z)
    return [id(b1.id, c1, v1 ?? 1), id(b2.id, c2, v2 ?? b2.verses[c2 - 1])]
  })
}
const src = JSON.parse(fs.readFileSync(path.join(root, 'scripts/data/mcheyne-source.json'), 'utf8'))
const days = src.map(line => {
  const parts = []
  for (const raw of line.replace(/–/g, '-').split(',').map(s => s.trim()).filter(Boolean)) {
    if (/^\d+$/.test(raw) && parts.length) parts[parts.length - 1] += `, ${raw}`  // "Jeremiah 36, 45"
    else parts.push(raw)
  }
  return parts.map(raw => { const label = raw.replace(/(\d)-(\d)/g, '$1–$2'); const r = ranges(raw); if (!r.length) throw new Error(`no ref: ${raw}`); return [label, ...r.flat()] })
})
if (days.length !== 365 || days.some(d => d.length !== 4)) throw new Error('unexpected shape ' + days.filter(d => d.length !== 4).map(d => d.map(x => x[0]).join('|')))
const out = path.join(root, 'app/public/data/plans/mcheyne.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(days))
console.log('wrote', out, days[0], days[59], days[364])
