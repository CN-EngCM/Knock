// 生成 assets/icon.png（256×256）：暖黑圆角底 + 纸白像素风 "$"。
// 与 index.html 里的内联 SVG 标签页图标同一设计（#0A0A08 底 / #EDE9DB 字）。
// 纯 Node 实现的 PNG 编码器（zlib.deflateSync + 手写 CRC32），零依赖，
// 只在需要重新生成图标时手动运行：node scripts/gen-icon.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 256
const BG = [0x0a, 0x0a, 0x08, 0xff] // 暖黑（不透明）
const FG = [0xed, 0xe9, 0xdb, 0xff] // 暖纸白
const RADIUS = 52

// '$' 的像素位图：5 列 × 7 行（S 形 + 贯穿竖杠），'#' = 前景色
const GLYPH = ['..#..', '.####', '#....', '.###.', '....#', '####.', '..#..']

// ── 画布 ──
const px = new Uint8Array(SIZE * SIZE * 4)

function fillRect(x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * SIZE + x) * 4
      px[i] = color[0]
      px[i + 1] = color[1]
      px[i + 2] = color[2]
      px[i + 3] = color[3]
    }
  }
}

// 背景：圆角矩形（点到圆角圆心距离法——256² 规模无需性能优化）
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const cx = Math.min(Math.max(x, RADIUS), SIZE - RADIUS)
    const cy = Math.min(Math.max(y, RADIUS), SIZE - RADIUS)
    const inCorner = (x !== cx || y !== cy) && Math.hypot(x - cx, y - cy) > RADIUS
    if (!inCorner) {
      const i = (y * SIZE + x) * 4
      px[i] = BG[0]
      px[i + 1] = BG[1]
      px[i + 2] = BG[2]
      px[i + 3] = BG[3]
    }
  }
}

// 字形：等比放大到画布 62% 高度内并居中
const cell = Math.floor((SIZE * 0.62) / GLYPH.length)
const gw = cell * 5
const gh = cell * GLYPH.length
const ox = Math.floor((SIZE - gw) / 2)
const oy = Math.floor((SIZE - gh) / 2)
GLYPH.forEach((row, ry) => {
  for (let rx = 0; rx < 5; rx++) {
    if (row[rx] === '#') fillRect(ox + rx * cell, oy + ry * cell, cell, cell, FG)
  }
})

// ── PNG 编码 ──
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

// 每行前置 filter 字节 0（None）；IHDR：8bit RGBA、无隔行
const raw = new Uint8Array(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  raw.set(px.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * (SIZE * 4 + 1) + 1)
}

const ihdr = new Uint8Array(13)
{
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, SIZE)
  dv.setUint32(4, SIZE)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型 RGBA
}

const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const idat = deflateSync(raw, { level: 9 })
const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
const total = parts.reduce((n, p) => n + p.length, 0)
const png = new Uint8Array(total)
let off = 0
for (const part of parts) {
  png.set(part, off)
  off += part.length
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`已生成 ${out} (${png.length} 字节)`)
