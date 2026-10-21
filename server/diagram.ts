import { deflateSync } from 'node:zlib'
import type { Scene } from '../shared/types.ts'
import { orbitalLayout } from '../shared/layout.ts'

export function sceneSvg(scene: Scene): string {
  const points = orbitalLayout(scene)
  const nodes = scene.components
    .map((component) => {
      const point = points[component.id]
      if (!point) return ''
      const x = 400 + point.x * 320
      const y = 400 + point.y * 320
      const focused = scene.focus === component.id
      return `<g>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${focused ? 8 : 4.5}" fill="${focused ? '#e8fbff' : '#071016'}" stroke="#3ee0ff" stroke-width="${focused ? 2 : 1}" />
        <text x="${(x + 12).toFixed(1)}" y="${(y + 4).toFixed(1)}" fill="#c5e7ef" font-size="11" font-family="ui-monospace, monospace">${escapeXml(component.label)}</text>
      </g>`
    })
    .join('')
  const edges = scene.edges
    .map((edge) => {
      const a = points[edge.from]
      const b = points[edge.to]
      if (!a || !b) return ''
      const x1 = 400 + a.x * 320
      const y1 = 400 + a.y * 320
      const x2 = 400 + b.x * 320
      const y2 = 400 + b.y * 320
      const dash = edge.style === 'sync' ? '' : ' stroke-dasharray="4 4"'
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#3ee0ff" stroke-opacity="0.7"${dash} />`
    })
    .join('')
  const rings = [90, 170, 250, 320].map((r) => `<circle cx="400" cy="400" r="${r}" fill="none" stroke="#1c3c44" />`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="#07090c" />
  ${rings}
  ${edges}
  ${nodes}
  <text x="36" y="44" fill="#7d8f9a" font-size="12" font-family="ui-monospace, monospace">${escapeXml(scene.title)} · v${String(scene.version).padStart(2, '0')}</text>
</svg>`
}

export function scenePng(scene: Scene): Buffer {
  const size = 640
  const pixels = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = 7
    pixels[i * 4 + 1] = 9
    pixels[i * 4 + 2] = 12
    pixels[i * 4 + 3] = 255
  }
  const points = orbitalLayout(scene)
  const xy = (id: string) => {
    const point = points[id]
    if (!point) return null
    return { x: Math.round(size / 2 + point.x * size * 0.38), y: Math.round(size / 2 + point.y * size * 0.38) }
  }
  for (const r of [70, 140, 210]) ring(pixels, size, size / 2, size / 2, r, [28, 70, 80, 255])
  for (const edge of scene.edges) {
    const a = xy(edge.from)
    const b = xy(edge.to)
    if (!a || !b) continue
    line(pixels, size, a.x, a.y, b.x, b.y, [62, 224, 255, 180])
  }
  for (const component of scene.components) {
    const point = xy(component.id)
    if (!point) continue
    const focused = scene.focus === component.id
    disc(pixels, size, point.x, point.y, focused ? 7 : 4, focused ? [232, 251, 255, 255] : [62, 224, 255, 255])
  }
  return encodePng(size, size, pixels)
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
}

function ring(pixels: Uint8Array, size: number, cx: number, cy: number, r: number, color: number[]) {
  const steps = Math.ceil(r * 6)
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    set(pixels, size, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), color)
  }
}

function disc(pixels: Uint8Array, size: number, cx: number, cy: number, r: number, color: number[]) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) set(pixels, size, cx + x, cy + y, color)
    }
  }
}

function line(pixels: Uint8Array, size: number, x0: number, y0: number, x1: number, y1: number, color: number[]) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    set(pixels, size, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), color)
  }
}

function set(pixels: Uint8Array, size: number, x: number, y: number, color: number[]) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const i = (y * size + x) * 4
  pixels[i] = color[0] ?? 0
  pixels[i + 1] = color[1] ?? 0
  pixels[i + 2] = color[2] ?? 0
  pixels[i + 3] = color[3] ?? 255
}

function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, row + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

function crc32(buf: Buffer): number {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c
}
