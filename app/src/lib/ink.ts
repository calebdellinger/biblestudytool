// Handwritten pages as vector ink.
//   A page has two layers: `trace` (paper notes turned into vector shapes; fixed) and `strokes` (pen strokes written
//   in the app; can be erased). Page space is 1000 units wide; height follows the page's shape.
// Tracing a photo: straighten → find the paper level → ink mask (with a Lighter/Darker threshold) → drop ruled
// lines and specks → sort ink into colours → follow the outline of every ink shape → simplify → smooth curves.
import { getStroke } from 'perfect-freehand'
import { paperLevels, warpImage, type Pt } from './scan'

export const PAGE_W = 1000
export type InkColor = 'ink' | 'blue' | 'red' | 'green'
export type Paper = 'plain' | 'lined' | 'grid'
export type TraceLayer = { k: InkColor; d: string }
/** One pen stroke: flat [x, y, pressure, x, y, pressure, …] in page units; w = nib size; hl = highlighter. */
export type InkStroke = { c: InkColor | 'yellow'; w: number; hl?: boolean; p: number[] }

export const INK_COLORS: Record<InkColor | 'yellow', string> = {
  ink: 'currentColor', blue: '#2c55b8', red: '#c0392b', green: '#2e7d4f', yellow: '#f2cf4a',
}

/* ---------------- tracing ---------------- */
const TRACE_MAX = 1600   // longest side traced, in pixels

export type Analysis = { W: number; H: number; dark: Float32Array; hue: Uint8Array }
/** Darkness of every pixel against its local paper, and which colour of ink it looks like (0 dark, 1 blue, 2 red, 3 green). */
export function analyse(src: HTMLCanvasElement, corners: Pt[]): Analysis {
  const img = warpImage(src, corners, TRACE_MAX)
  const { width: W, height: H, data: d } = img
  const { gray, paper } = paperLevels(img)
  const dark = new Float32Array(W * H)
  for (let i = 0; i < dark.length; i++) dark[i] = Math.max(0, 1 - gray[i] / Math.max(40, paper[i]))
  // paper tint (average colour of clearly-paper pixels), so yellowish paper doesn't make all ink look "coloured"
  let tr = 0, tg = 0, tb = 0, tn = 0
  for (let i = 0; i < dark.length; i += 7) if (dark[i] < 0.05) { tr += d[i * 4]; tg += d[i * 4 + 1]; tb += d[i * 4 + 2]; tn++ }
  const pr = tn ? tr / tn : 255, pg = tn ? tg / tn : 255, pb = tn ? tb / tn : 255
  const hue = new Uint8Array(W * H)
  for (let i = 0; i < hue.length; i++) {
    if (dark[i] < 0.12) continue
    const r = d[i * 4] / pr, g = d[i * 4 + 1] / pg, b = d[i * 4 + 2] / pb
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (mx - mn < 0.2 * Math.max(0.25, mx)) continue   // grey/black ink or pencil
    let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4
    h = (h * 60 + 360) % 360
    hue[i] = h >= 190 && h < 275 ? 1 : h >= 320 || h < 25 ? 2 : h >= 75 && h < 170 ? 3 : 0
  }
  return { W, H, dark, hue }
}

/** Which pixels are ink, for a given sensitivity (0 = only the boldest strokes … 1 = faint pencil too). */
export function inkMask(a: Analysis, sensitivity = 0.5): Uint8Array {
  const { W, H, dark, hue } = a
  const t = 0.42 - sensitivity * 0.3          // darkness threshold, 0.42 … 0.12
  const m = new Uint8Array(W * H)
  for (let i = 0; i < m.length; i++) {
    if (dark[i] < t) continue
    if (hue[i] === 1 && dark[i] < 0.4) continue  // pale blue: printed ruled lines, not ink
    m[i] = 1
  }
  // Ruled lines that are dark enough to pass: rows mostly covered across the page, only a few pixels thick.
  const rowFill = new Float32Array(H)
  for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) n += m[y * W + x]; rowFill[y] = n / W }
  for (let y = 0; y < H; y++) {
    if (rowFill[y] < 0.45) continue
    for (let x = 0; x < W; x++) {
      const up = y >= 4 && m[(y - 4) * W + x], down = y < H - 4 && m[(y + 4) * W + x]
      if (!(up && down)) m[y * W + x] = 0      // keep pixels where a letter crosses the line
    }
  }
  // margins: ignore a thin border where the page edge or desk can show
  const bx = Math.round(W * 0.012), by = Math.round(H * 0.012)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < bx || y < by || x >= W - bx || y >= H - by) m[y * W + x] = 0
  closeMask(m, W, H)
  dropSpecks(m, W, H, Math.max(6, Math.round((W / 1000) ** 2 * 8)))
  return m
}

/** Fill hairline gaps inside strokes (a pen skip, a faint join) without fattening the writing: grow by one pixel, then shrink. */
function closeMask(m: Uint8Array, W: number, H: number) {
  const g = new Uint8Array(m.length)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    g[i] = m[i] | m[i - 1] | m[i + 1] | m[i - W] | m[i + W]
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    m[i] = g[i] & g[i - 1] & g[i + 1] & g[i - W] & g[i + W]
  }
}

function dropSpecks(m: Uint8Array, W: number, H: number, minArea: number) {
  const seen = new Uint8Array(m.length), stack: number[] = [], comp: number[] = []
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || seen[s]) continue
    stack.length = 0; comp.length = 0; stack.push(s); seen[s] = 1
    while (stack.length) {
      const i = stack.pop()!; comp.push(i)
      const x = i % W, y = (i / W) | 0
      if (x > 0 && m[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1) }
      if (x < W - 1 && m[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1) }
      if (y > 0 && m[i - W] && !seen[i - W]) { seen[i - W] = 1; stack.push(i - W) }
      if (y < H - 1 && m[i + W] && !seen[i + W]) { seen[i + W] = 1; stack.push(i + W) }
      if (comp.length > minArea) { /* big enough; keep going to mark it seen */ }
    }
    if (comp.length < minArea) for (const i of comp) m[i] = 0
  }
}

/** Vector shapes for the ink, one layer per ink colour. Each connected shape (a letter, a word in joined writing)
 *  takes one colour: the pen colour most of its pixels show, so edges don't split into a second colour. */
export function trace(a: Analysis, mask: Uint8Array, colours = true): TraceLayer[] {
  const { W, H, hue } = a
  const label = new Int32Array(mask.length).fill(-1)
  const compColour: number[] = []
  const stack: number[] = []
  for (let s0 = 0; s0 < mask.length; s0++) {
    if (!mask[s0] || label[s0] >= 0) continue
    const id = compColour.length
    const cnt = [0, 0, 0, 0]
    stack.length = 0; stack.push(s0); label[s0] = id
    while (stack.length) {
      const i = stack.pop()!; cnt[hue[i]]++
      const x = i % W
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W, x > 0 ? i - W - 1 : -1, x < W - 1 ? i - W + 1 : -1, x > 0 ? i + W - 1 : -1, x < W - 1 ? i + W + 1 : -1]
      for (const j of nb) if (j >= 0 && j < mask.length && mask[j] && label[j] < 0) { label[j] = id; stack.push(j) }
    }
    const coloured = cnt[1] + cnt[2] + cnt[3]
    const best = cnt[1] >= cnt[2] && cnt[1] >= cnt[3] ? 1 : cnt[2] >= cnt[3] ? 2 : 3
    compColour.push(colours && coloured >= 0.35 * (coloured + cnt[0]) ? best : 0)
  }
  const names: InkColor[] = ['ink', 'blue', 'red', 'green']
  const scale = PAGE_W / W
  const layers: TraceLayer[] = []
  for (let k = 0; k < 4; k++) {
    if (!compColour.includes(k)) continue
    const m = new Uint8Array(W * H)
    for (let i = 0; i < m.length; i++) if (label[i] >= 0 && compColour[label[i]] === k) m[i] = 1
    const d = contoursToPath(m, W, H, scale)
    if (d) layers.push({ k: names[k], d })
  }
  return layers
}

/** Follow the boundary of every ink shape (pixel edges with ink on the right), simplify, and smooth into curves. */
function contoursToPath(m: Uint8Array, W: number, H: number, scale: number): string {
  const VW = W + 1
  const out1 = new Int32Array(VW * (H + 1)).fill(-1), out2 = new Int32Array(VW * (H + 1)).fill(-1)
  const add = (from: number, to: number) => { if (out1[from] < 0) out1[from] = to; else out2[from] = to }
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!m[y * W + x]) continue
    const tl = y * VW + x, tr = tl + 1, bl = tl + VW, br = bl + 1
    if (!ink(x, y - 1)) add(tl, tr)
    if (!ink(x + 1, y)) add(tr, br)
    if (!ink(x, y + 1)) add(br, bl)
    if (!ink(x - 1, y)) add(bl, tl)
  }
  const parts: string[] = []
  for (let start = 0; start < out1.length; start++) {
    if (out1[start] < 0) continue
    const loop: Pt[] = []
    let v = start, guard = 0
    while (guard++ < 2_000_000) {
      const nxt = out1[v] >= 0 ? out1[v] : out2[v]
      if (nxt < 0) break
      if (out1[v] === nxt) { out1[v] = out2[v]; out2[v] = -1 } else out2[v] = -1
      loop.push([v % VW, (v / VW) | 0])
      v = nxt
      if (v === start) break
    }
    if (loop.length < 4) continue
    const corners = staircaseCorners(loop)
    const simple = rdpClosed(corners, 1.0)
    if (simple.length < 3) continue
    parts.push(smoothClosed(simple, scale))
  }
  return parts.join('')
}
function staircaseCorners(p: Pt[]): Pt[] {
  const n = p.length, out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n]
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b)
  }
  // pixel corners → midpoints of the steps gives a less blocky outline
  const mids: Pt[] = []
  for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) }
  return mids.length >= 3 ? mids : out
}
function rdp(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p
  const [a, b] = [p[0], p[p.length - 1]]
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1
  let worst = 0, at = 0
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / len
    if (d > worst) { worst = d; at = i }
  }
  if (worst <= eps) return [a, b]
  return [...rdp(p.slice(0, at + 1), eps).slice(0, -1), ...rdp(p.slice(at), eps)]
}
function rdpClosed(p: Pt[], eps: number): Pt[] {
  // split at the point farthest from the first, simplify both halves
  let far = 0, fd = 0
  for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > fd) { fd = d; far = i } }
  const a = rdp(p.slice(0, far + 1), eps), b = rdp([...p.slice(far), p[0]], eps)
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}
const f1 = (n: number) => Math.round(n * 10) / 10
/** Quadratic curves through the midpoints of a closed polygon. */
function smoothClosed(p: Pt[], s: number): string {
  // relative, whole-unit coordinates keep a page small (most moves are 1–2 digits)
  const n = p.length, r = Math.round
  const mid = (i: number): Pt => { const a = p[i % n], b = p[(i + 1) % n]; return [r((a[0] + b[0]) / 2 * s * 2) / 2, r((a[1] + b[1]) / 2 * s * 2) / 2] }
  const m0 = mid(n - 1)
  let [cx, cy] = m0
  let d = `M${m0[0]} ${m0[1]}q`
  const num = (v: number) => { const t = String(Math.round(v * 2) / 2); return t.startsWith('-') ? t : ' ' + t }
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const c: Pt = [r(p[i][0] * s * 2) / 2, r(p[i][1] * s * 2) / 2], m = mid(i)
    parts.push(num(c[0] - cx) + num(c[1] - cy) + num(m[0] - cx) + num(m[1] - cy))
    cx = m[0]; cy = m[1]
  }
  d += parts.join('').trimStart()
  return d.replace(/q /, 'q') + 'z'
}

/* ---------------- pen strokes ---------------- */
const NIBS: Record<number, number> = { 1: 3.2, 2: 5, 3: 8 }
export const nibSize = (w: number, hl?: boolean) => (hl ? 26 : NIBS[w] ?? 5)
/** The outline of a pen stroke as an SVG path (pressure-sensitive with an Apple Pencil). */
export function strokePath(s: InkStroke): string {
  const pts: number[][] = []
  for (let i = 0; i < s.p.length; i += 3) pts.push([s.p[i], s.p[i + 1], s.p[i + 2] / 100])
  const hasPressure = pts.some(p => p[2] > 0 && p[2] !== 0.5)
  const outline = getStroke(pts, {
    size: nibSize(s.w, s.hl), thinning: s.hl ? 0 : hasPressure ? 0.6 : 0.45, smoothing: 0.55, streamline: 0.45,
    simulatePressure: !hasPressure && !s.hl, last: true,
    start: { cap: !s.hl }, end: { cap: !s.hl },
  })
  if (!outline.length) return ''
  let d = `M${f1(outline[0][0])} ${f1(outline[0][1])}`
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i], [x1, y1] = outline[(i + 1) % outline.length]
    d += `Q${f1(x0)} ${f1(y0)} ${f1((x0 + x1) / 2)} ${f1((y0 + y1) / 2)}`
  }
  return d + 'Z'
}
/** Is the point within r of any part of the stroke? (for the eraser) */
export function strokeHit(s: InkStroke, x: number, y: number, r: number) {
  const rr = (r + nibSize(s.w, s.hl) / 2) ** 2
  for (let i = 0; i < s.p.length; i += 3) if ((s.p[i] - x) ** 2 + (s.p[i + 1] - y) ** 2 <= rr) return true
  return false
}
