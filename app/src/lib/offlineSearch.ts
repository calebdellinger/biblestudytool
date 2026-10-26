// Search the theologians on this device, from the offline library, for when the PC can't be reached.
// Same scoring as the PC's search (server/server.mjs spSearch), reading the saved files instead of the PC's disk.
import type { SearchHit } from './spurgeon'

type Scored = SearchHit & { score: number }
const plain = (t: string) => t.replace(/[*_>#`]/g, '').replace(/\s+/g, ' ')
function scoreText(text: string, res: RegExp[]) {
  let score = 0
  for (const re of res) {
    re.lastIndex = 0
    let n = 0
    while (re.exec(text) && n < 50) n++
    if (!n) return 0
    score += n
  }
  return score
}
function snippet(text: string, re: RegExp) {
  re.lastIndex = 0
  const m = re.exec(text)
  const at = m ? m.index : 0
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 110)))
  return (start > 0 ? '…' : '') + plain(text.slice(start, at + 170)).trim() + '…'
}
async function saved(p: string, as: 'text' | 'json') {
  const r = await caches.match(p)
  if (!r) return null
  return as === 'json' ? r.json() : r.text()
}

/** Null when the Spurgeon section isn't saved on this device. */
export async function searchOnDevice(q: string, onProgress?: (fraction: number) => void): Promise<SearchHit[] | null> {
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1).slice(0, 8)
  if (!words.length) return []
  const res = words.map(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'))
  const sermons = (await saved('/data/spurgeon/sermons.json', 'json')) as [string, string | number, string][] | null
  if (!sermons) return null
  const hits: Scored[] = []

  const queue = [...sermons]
  let done = 0, lastYield = performance.now()
  async function worker() {
    for (let s; (s = queue.shift());) {
      const text = (await saved(`/data/spurgeon/sermons/${s[0]}.md`, 'text').catch(() => null)) as string | null
      done++
      if (text) {
        const score = scoreText(text, res) + (scoreText(s[2], res) ? 40 : 0)
        if (score) hits.push({ score, kind: 'sermon', id: s[0], title: s[2], ref: `Sermon ${s[1]}`, snippet: snippet(text, res[0]) })
      }
      if (performance.now() - lastYield > 200) { lastYield = performance.now(); onProgress?.(done / sermons!.length * 0.85); await new Promise(r => setTimeout(r)) }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))

  const readings = (await saved('/data/spurgeon/morning-evening.json', 'json').catch(() => null)) as string[][] | null
  for (const r of readings ?? []) {
    const score = scoreText(r[6], res)
    if (score) hits.push({ score: score + 5, kind: 'reading', id: `${r[0]}-${r[1]}`, title: `${r[1] === 'morning' ? 'Morning' : 'Evening'}, ${r[0].replace('-', ' ')}`, ref: r[2], snippet: snippet(r[6], res[0]) })
  }
  for (let n = 1; n <= 150; n++) {
    const t = await saved(`/data/spurgeon/tod/${n}.json`, 'json').catch(() => null) as { intro: string; exposition: string[][]; notes: string[][]; hints: string[][] } | null
    if (!t) continue
    const text = [t.intro, ...t.exposition.map(x => x[2]), ...t.notes.map(x => x[2]), ...t.hints.map(x => x[2])].join('\n\n')
    const score = scoreText(text, res)
    if (score) hits.push({ score, kind: 'psalm', id: String(n), title: `Psalm ${n}`, ref: 'The Treasury of David', snippet: snippet(text, res[0]) })
  }
  onProgress?.(0.92)

  const lib = await saved('/data/theologians/index.json', 'json').catch(() => null) as { authors: { name: string; works: { id: string; title: string; chapters: [number, string, number][] }[] }[] } | null
  for (const a of lib?.authors ?? []) for (const w of a.works) for (const [n, title] of w.chapters) {
    const text = await saved(`/data/theologians/works/${w.id}/${n}.md`, 'text').catch(() => null) as string | null
    if (!text) continue
    const score = scoreText(text, res) + (scoreText(title, res) || scoreText(w.title, res) ? 30 : 0)
    if (score) hits.push({ score, kind: 'work', id: `${w.id}/${n}`, title: `${w.title}: ${title}`, ref: a.name, snippet: snippet(text, res[0]) })
  }
  onProgress?.(1)

  hits.sort((a, b) => b.score - a.score)
  const top = hits.slice(0, 60), books = hits.filter(h => h.kind === 'work').slice(0, 15)
  const missing = books.filter(b => !top.includes(b))
  return [...top.slice(0, 60 - missing.length), ...missing].sort((a, b) => b.score - a.score).map(({ score: _s, ...h }) => h)
}
