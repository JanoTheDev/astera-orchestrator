// Generates every app icon asset from the Astera mark (DESIGN.md §9, Wave 9).
//   From the repo root:  node scripts/gen-icons.mjs
//
// The mark is two shapes — a rounded square and a stroked pulse line — so it is rasterised here
// directly, with 4×4 supersampling, instead of through an image tool. Keep MARK in step with
// assets/mark.svg (same 64-unit coordinates); nothing else reads that file at build time.
//
// Outputs build/icon.png 512 · build/icon.ico 16..256 (PNG-in-ICO) · build/icon.icns 16..1024 (PNG chunks)
//         resources/icon.png 256 (window icon) · resources/tray.png 32 (tray icon, shown at 16/22 px)
//         assets/mark-1024.png 1024 (committed master; the source of truth is MARK below + assets/mark.svg)
// Each size is rendered from the geometry at that size, not downscaled.
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, crc32 } from 'node:zlib'

const MARK = {
  rect: { x: 2, y: 2, w: 60, h: 60, r: 15, fill: [0xc4, 0xf2, 0x5a] },
  line: {
    points: [[11, 34], [20.5, 34], [25.5, 21.5], [34, 44.5], [40.5, 29], [44, 34], [53, 34]],
    width: 5,
    stroke: [0x12, 0x1a, 0x00]
  }
}

function inRoundedRect(px, py, { x, y, w, h, r }) {
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r && px >= x && px <= x + w && py >= y && py <= y + h
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function onLine(px, py, { points, width }) {
  for (let i = 1; i < points.length; i++) if (distToSegment(px, py, points[i - 1], points[i]) <= width / 2) return true
  return false
}

const SS = 4
function render(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const k = 64 / size
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let fill = 0
      let stroke = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) * k
          const py = (y + (sy + 0.5) / SS) * k
          if (!inRoundedRect(px, py, MARK.rect)) continue
          if (onLine(px, py, MARK.line)) stroke++
          else fill++
        }
      const n = SS * SS
      const a = (fill + stroke) / n
      const i = (y * size + x) * 4
      if (a === 0) continue
      for (let c = 0; c < 3; c++)
        rgba[i + c] = Math.round((MARK.rect.fill[c] * fill + MARK.line.stroke[c] * stroke) / (fill + stroke))
      rgba[i + 3] = Math.round(a * 255)
    }
  return png(size, rgba)
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach(([size, data], i) => {
    const e = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, e)
    head.writeUInt8(size >= 256 ? 0 : size, e + 1)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...pngs.map(([, data]) => data)])
}

function icns(chunks) {
  const parts = chunks.map(([type, data]) => {
    const h = Buffer.alloc(8)
    h.write(type, 0, 'ascii')
    h.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([h, data])
  })
  const h = Buffer.alloc(8)
  h.write('icns', 0, 'ascii')
  h.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0), 4)
  return Buffer.concat([h, ...parts])
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = {}
for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) out[s] = render(s)
writeFileSync(join(root, 'build/icon.png'), out[512])
writeFileSync(join(root, 'build/icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((s) => [s, out[s]])))
writeFileSync(
  join(root, 'build/icon.icns'),
  icns([['icp4', out[16]], ['icp5', out[32]], ['icp6', out[64]], ['ic07', out[128]], ['ic08', out[256]], ['ic09', out[512]], ['ic10', out[1024]]])
)
writeFileSync(join(root, 'resources/icon.png'), out[256])
writeFileSync(join(root, 'resources/tray.png'), out[32])
writeFileSync(join(root, 'assets/mark-1024.png'), out[1024])
