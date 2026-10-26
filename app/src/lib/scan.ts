// Turning a phone photo of handwritten pages into a clean "scanned" page, all on the device.
//   1. straighten: the four corners you drag become a flat rectangle (perspective correction)
//   2. clean up (Scan mode): even out shadows and uneven light, white paper, dark ink, greyscale
//   3. save as a JPEG attached to the note, which syncs to the PC like everything else
export type Pt = [number, number]
export type Mode = 'scan' | 'photo'
const MAX_SRC = 2600   // longest side kept from the photo
const MAX_OUT = 2000   // longest side of the saved page

/** The photo as a canvas, upright (EXIF orientation applied), turned by `quarter` × 90° clockwise. */
export async function photoCanvas(file: Blob, quarter = 0): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, MAX_SRC / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k)
  const turn = ((quarter % 4) + 4) % 4
  const c = document.createElement('canvas')
  c.width = turn % 2 ? h : w; c.height = turn % 2 ? w : h
  const g = c.getContext('2d')!
  g.translate(c.width / 2, c.height / 2); g.rotate((turn * Math.PI) / 2)
  g.drawImage(bmp, -w / 2, -h / 2, w, h)
  bmp.close?.()
  return c
}

/** Unit square → quad (top-left, top-right, bottom-right, bottom-left). Heckbert's projective mapping. */
function squareToQuad(q: Pt[]) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  let g = 0, h = 0
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dy1 * dx2
    g = (dx3 * dy2 - dy3 * dx2) / den
    h = (dx1 * dy3 - dy1 * dx3) / den
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0
  return (u: number, v: number): Pt => { const w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w] }
}
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Flatten the quad into an upright page and (in Scan mode) clean it up. Returns a JPEG. */
/** Flatten the quad into an upright rectangle, at most `maxOut` pixels on its longest side. */
export function warpImage(src: HTMLCanvasElement, corners: Pt[], maxOut = MAX_OUT): ImageData {
  const [tl, tr, br, bl] = corners
  let W = Math.max(dist(tl, tr), dist(bl, br)), H = Math.max(dist(tl, bl), dist(tr, br))
  const k = Math.min(1, maxOut / Math.max(W, H)); W = Math.max(1, Math.round(W * k)); H = Math.max(1, Math.round(H * k))
  const sw = src.width, sh = src.height
  const sd = src.getContext('2d')!.getImageData(0, 0, sw, sh).data
  const map = squareToQuad(corners)
  const out = new ImageData(W, H)
  const o = out.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [sx, sy] = map(0.004 + 0.992 * (x + 0.5) / W, 0.004 + 0.992 * (y + 0.5) / H)   // a hair inside the corners, so no desk shows at the edges
      // bilinear sample
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(sx - 0.5))), y0 = Math.max(0, Math.min(sh - 2, Math.floor(sy - 0.5)))
      const fx = Math.max(0, Math.min(1, sx - 0.5 - x0)), fy = Math.max(0, Math.min(1, sy - 0.5 - y0))
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4
      const j = (y * W + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        const top = sd[i00 + ch] * (1 - fx) + sd[i10 + ch] * fx
        const bot = sd[i01 + ch] * (1 - fx) + sd[i11 + ch] * fx
        o[j + ch] = top * (1 - fy) + bot * fy
      }
      o[j + 3] = 255
    }
  }
  return out
}

export async function makePage(src: HTMLCanvasElement, corners: Pt[], mode: Mode): Promise<Blob> {
  const out = warpImage(src, corners)
  const W = out.width, H = out.height
  if (mode === 'scan') cleanUp(out); else autoLevels(out)
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  c.getContext('2d')!.putImageData(out, 0, 0)
  return new Promise((ok, fail) => c.toBlob(b => (b ? ok(b) : fail(new Error('Could not save the page.'))), 'image/jpeg', mode === 'scan' ? 0.78 : 0.84))
}

/** Paper white, ink dark, shadows gone. Divides each pixel by the local paper brightness. */
function cleanUp(img: ImageData) {
  const { width: W, height: H, data: d } = img
  const { gray, paper } = paperLevels(img)
  for (let i = 0; i < gray.length; i++) {
    const r = Math.min(1, gray[i] / Math.max(40, paper[i]))
    // r ≈ 1 on paper, lower on ink. Map 0.62…0.93 to black…white, gently curved so pencil stays readable.
    let v = (r - 0.62) / 0.31
    v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, 1.4)
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(v * 255)
  }
  void W; void H
}

/** Greyscale of the page and, for every pixel, how bright the paper is there (ink is dark, so the local bright level is paper). */
export function paperLevels(img: ImageData): { gray: Float32Array; paper: Float32Array } {
  const { width: W, height: H, data: d } = img
  const gray = new Float32Array(W * H)
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
  // Paper brightness: a coarse grid of local maxima (ink is dark, so the max is the paper), then smoothed.
  const S = Math.max(8, Math.round(Math.max(W, H) / 60))
  const gw = Math.ceil(W / S), gh = Math.ceil(H / S)
  let bg = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    // 90th percentile of the cell rather than the max, so specks of glare don't count as paper
    const vals: number[] = []
    for (let y = gy * S; y < Math.min(H, (gy + 1) * S); y += 2) for (let x = gx * S; x < Math.min(W, (gx + 1) * S); x += 2) vals.push(gray[y * W + x])
    vals.sort((a, b) => a - b)
    bg[gy * gw + gx] = vals[Math.floor(vals.length * 0.9)] ?? 255
  }
  // spread the paper level over cells covered by big dark areas, then blur
  for (let pass = 0; pass < 2; pass++) {
    const nb = new Float32Array(bg.length)
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let m = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.min(gw - 1, Math.max(0, x + dx)), yy = Math.min(gh - 1, Math.max(0, y + dy))
        m = Math.max(m, bg[yy * gw + xx])
      }
      nb[y * gw + x] = m
    }
    bg = nb
  }
  for (let pass = 0; pass < 3; pass++) {
    const nb = new Float32Array(bg.length)
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) { s += bg[yy * gw + xx]; n++ }
      }
      nb[y * gw + x] = s / n
    }
    bg = nb
  }
  const bAt = (x: number, y: number) => bg[Math.min(gh - 1, y) * gw + Math.min(gw - 1, x)]
  const paper = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const gyf = Math.max(0, y / S - 0.5), gy0 = Math.floor(gyf), fy = gyf - gy0
    for (let x = 0; x < W; x++) {
      const gxf = Math.max(0, x / S - 0.5), gx0 = Math.floor(gxf), fx = gxf - gx0
      paper[y * W + x] = (bAt(gx0, gy0) * (1 - fx) + bAt(gx0 + 1, gy0) * fx) * (1 - fy) + (bAt(gx0, gy0 + 1) * (1 - fx) + bAt(gx0 + 1, gy0 + 1) * fx) * fy
    }
  }
  return { gray, paper }
}

/** Photo mode: keep colour, just stretch the levels a little. */
function autoLevels(img: ImageData) {
  const d = img.data, hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++
  const n = d.length / 4
  let lo = 0, hi = 255, acc = 0
  while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++
  acc = 0
  while (hi > 0 && (acc += hist[hi]) < n * 0.01) hi--
  if (hi - lo < 40) return
  const k = 255 / (hi - lo)
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, (d[i + c] - lo) * k))
}
