// Matthew Henry's Commentary (public domain; markdown editions by lyteword, CC0).
//   node scripts/build_henry.mjs <folder containing mhenry-complete and mhenry-concise>
// Output: app/public/data/commentary/henry-concise/<book>.json  {chapter: {outline, sections: [[s, e, md]]}}
//         app/public/data/commentary/henry/<book>.json          {chapter: {intro, sections: [[s, e, title, md]]}}
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SRC = process.argv[2]
const OUT = path.join(ROOT, 'app', 'public', 'data', 'commentary')
const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'public', 'data', 'books.json'), 'utf8'))
const slug = n => n.toLowerCase().replace(/\s+/g, '-')
const BOOK = Object.fromEntries(books.map(b => [slug(b.name), b.id]))
BOOK['song-of-solomon'] = BOOK['song-of-songs']
const decode = s => s.replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\\([.\-*_()])/g, '$1')
const strip = s => decode(s).replace(/^---[\s\S]*?---\s*/, '')
const SUP = { '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 }
const supNum = s => [...s].reduce((n, ch) => n * 10 + SUP[ch], 0)
const range = s => { const m = s.match(/(\d+)(?:\s*[–\-,&]\s*(\d+))?/); return m ? [+m[1], +(m[2] ?? m[1])] : null }

function chapterFiles(dir) {
  const out = []
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(?:chapter|psalm)-(\d+)\.md$/)
    if (m) out.push([+m[1], path.join(dir, f)])
  }
  return out
}

let stats = { concise: 0, complete: 0, sections: 0 }
// ---- concise: "## Verses 1–5" sections and a "## Chapter Outline"
{
  const dir = path.join(SRC, 'mhenry-concise'), out = path.join(OUT, 'henry-concise')
  fs.mkdirSync(out, { recursive: true })
  for (const b of fs.readdirSync(dir)) {
    if (!BOOK[b]) continue
    const data = {}
    for (const [c, file] of chapterFiles(path.join(dir, b))) {
      const lines = strip(fs.readFileSync(file, 'utf8')).split('\n')
      let outline = [], sections = [], cur = null, inOutline = false
      for (const l of lines) {
        const h = l.match(/^##\s+(.*)/)
        if (h) {
          inOutline = /outline/i.test(h[1])
          const r = range(h[1])
          cur = !inOutline ? [...(r ?? [1, 999]), []] : null
          if (cur) sections.push(cur)
          continue
        }
        if (l.startsWith('# ')) continue
        if (inOutline) outline.push(l); else if (cur) cur[2].push(l)
      }
      data[c] = { outline: outline.join('\n').trim(), sections: sections.map(([s, e, l]) => [s, e, l.join('\n').trim()]).filter(x => x[2]) }
      stats.concise++
    }
    fs.writeFileSync(path.join(out, `${BOOK[b]}.json`), JSON.stringify(data))
  }
}
// ---- complete: "## Title (date)" sections whose quoted text carries superscript verse numbers
{
  const dir = path.join(SRC, 'mhenry-complete'), out = path.join(OUT, 'henry')
  fs.mkdirSync(out, { recursive: true })
  for (const vol of fs.readdirSync(dir).filter(v => v.startsWith('volume-'))) {
    for (const b of fs.readdirSync(path.join(dir, vol))) {
      if (!BOOK[b]) continue
      const data = {}
      for (const [c, file] of chapterFiles(path.join(dir, vol, b))) {
        const lines = strip(fs.readFileSync(file, 'utf8')).split('\n')
        let intro = [], sections = [], cur = null
        for (const l of lines) {
          const h = l.match(/^##\s+(.*)/)
          if (h) { cur = { title: h[1].trim(), verses: [], body: [] }; sections.push(cur); continue }
          if (l.startsWith('# ')) continue
          if (!cur) { intro.push(l); continue }
          if (l.startsWith('>')) {
            for (const m of l.matchAll(/\*\*([⁰¹²³⁴⁵⁶⁷⁸⁹]+)\*\*/g)) cur.verses.push(supNum(m[1]))
            if (!cur.body.length) continue // the quoted Bible text itself; the reader already shows it
          }
          cur.body.push(l)
        }
        let last = 0
        data[c] = {
          intro: intro.join('\n').trim(),
          sections: sections.map(s => {
            const lo = s.verses.length ? Math.min(...s.verses) : last + 1, hi = s.verses.length ? Math.max(...s.verses) : lo
            last = hi
            stats.sections++
            return [lo, hi, s.title, s.body.join('\n').trim()]
          }).filter(x => x[3]),
        }
        stats.complete++
      }
      fs.writeFileSync(path.join(out, `${BOOK[b]}.json`), JSON.stringify(data))
    }
  }
}
console.log(stats)
