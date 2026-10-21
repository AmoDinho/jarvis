import type { Scene } from './types.ts'

export type Point = { x: number; y: number; hop: number }

/**
 * Auto-layout for 20+ components without overlaps.
 * Orbital uses hop rings from the lit component (graph structure).
 * Grid packing is by domain row, so tidy() never stacks two parts on one cell.
 * Constellation places each domain in its own region, then spirals inside it.
 */

export function coreId(scene: Scene): string | undefined {
  if (scene.focus && scene.components.some((c) => c.id === scene.focus)) return scene.focus
  if (!scene.components.length) return undefined
  let best = scene.components[0]!
  let bestScore = -1
  for (const component of scene.components) {
    const degree = scene.edges.filter((e) => e.from === component.id || e.to === component.id).length
    const score = degree * 10 + (component.kind === 'service' ? 3 : 0)
    if (score > bestScore) {
      best = component
      bestScore = score
    }
  }
  return best.id
}

export function hopMap(scene: Scene, origin: string): Map<string, number> {
  const hops = new Map<string, number>([[origin, 0]])
  const queue = [origin]
  while (queue.length) {
    const current = queue.shift()!
    const hop = hops.get(current) ?? 0
    for (const edge of scene.edges) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null
      if (!next || hops.has(next)) continue
      hops.set(next, hop + 1)
      queue.push(next)
    }
  }
  return hops
}

export function orbitalLayout(scene: Scene): Record<string, Point> {
  const origin = coreId(scene)
  if (!origin) return {}
  const hops = hopMap(scene, origin)
  const byHop = new Map<number, string[]>()
  for (const component of scene.components) {
    const hop = component.id === origin ? 0 : (hops.get(component.id) ?? 4)
    const list = byHop.get(hop) ?? []
    list.push(component.id)
    byHop.set(hop, list)
  }
  const points: Record<string, Point> = {}
  points[origin] = { x: 0, y: 0, hop: 0 }
  for (const [hop, ids] of byHop) {
    if (hop === 0) continue
    const base = hop === 1 ? 0.34 : hop === 2 ? 0.56 : Math.min(0.9, 0.56 + (hop - 2) * 0.14)
    const perRing = 8
    ids.forEach((id, index) => {
      const layer = Math.floor(index / perRing)
      const indexInLayer = index % perRing
      const count = Math.min(perRing, ids.length - layer * perRing)
      const radius = base + layer * 0.1
      const offset = -Math.PI / 2 + hop * 0.35
      const angle = offset + (indexInLayer * 2 * Math.PI) / count
      points[id] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, hop }
    })
  }
  return points
}

const REGIONS: Record<string, { x: number; y: number }> = {
  edge: { x: -0.62, y: -0.28 },
  quoting: { x: 0.02, y: 0.08 },
  policy: { x: 0.58, y: -0.02 },
  external: { x: 0.48, y: -0.52 },
  events: { x: 0.42, y: 0.22 },
}

export function constellationLayout(scene: Scene): Record<string, Point> {
  const groups = new Map<string, string[]>()
  for (const component of scene.components) {
    const key = component.group || component.kind
    const list = groups.get(key) ?? []
    list.push(component.id)
    groups.set(key, list)
  }
  const points: Record<string, Point> = {}
  let extra = 0
  for (const [group, ids] of groups) {
    const region = REGIONS[group] ?? {
      x: Math.cos(extra) * 0.7,
      y: Math.sin(extra) * 0.55,
    }
    if (!REGIONS[group]) extra += 1.4
    ids.forEach((id, index) => {
      const angle = index * 2.15 + group.length
      const radius = 0.02 + index * 0.055
      points[id] = {
        x: clampUnit(region.x + Math.cos(angle) * radius),
        y: clampUnit(region.y + Math.sin(angle) * radius * 0.72),
        hop: 0,
      }
    })
  }
  return points
}

export function satelliteLayout(scene: Scene): Record<string, Point> {
  const anchors = constellationLayout(scene)
  const byGroup = new Map<string, Point>()
  for (const component of scene.components) {
    const point = anchors[component.id]
    if (!point) continue
    const key = component.group || component.kind
    if (!byGroup.has(key)) byGroup.set(key, point)
  }
  const points: Record<string, Point> = {}
  for (const sat of scene.satellites ?? []) {
    const anchor = byGroup.get(sat.group) ?? { x: 0, y: 0, hop: 0 }
    const seed = hash(sat.id)
    const angle = (seed % 360) * (Math.PI / 180)
    const radius = 0.08 + ((seed >> 4) % 18) / 100
    points[sat.id] = {
      x: clampUnit(anchor.x + Math.cos(angle) * radius),
      y: clampUnit(anchor.y + Math.sin(angle) * radius * 0.8),
      hop: 0,
    }
  }
  return points
}

/** Isometric floor coordinates. gx/gy are grid cells; x/z are world units. */
export function isoLayout(scene: Scene): Record<string, { x: number; y: number; z: number; gx: number; gy: number }> {
  const packed = packGrid(scene)
  const points: Record<string, { x: number; y: number; z: number; gx: number; gy: number }> = {}
  for (const component of scene.components) {
    const [gx, gy] = component.position ?? packed[component.id] ?? [0, 0]
    points[component.id] = {
      gx,
      gy,
      x: (gx - gy) * 1.7,
      y: 0,
      z: (gx + gy) * 1.7,
    }
  }
  return points
}

export function packGrid(scene: Scene): Record<string, [number, number]> {
  const groups = new Map<string, string[]>()
  for (const component of scene.components) {
    const key = component.group || component.kind
    const list = groups.get(key) ?? []
    list.push(component.id)
    groups.set(key, list)
  }
  const points: Record<string, [number, number]> = {}
  let row = 0
  for (const ids of groups.values()) {
    ids.forEach((id, column) => {
      const component = scene.components.find((c) => c.id === id)
      points[id] = component?.position ?? [column, row]
    })
    row += 1
  }
  return points
}

export function heatColor(util: number): string {
  const t = Math.max(0, Math.min(1, util))
  if (t < 0.45) return lerpColor('#3ee0ff', '#ffb020', t / 0.45)
  if (t < 0.75) return lerpColor('#ffb020', '#ff7a1a', (t - 0.45) / 0.3)
  return lerpColor('#ff7a1a', '#ff4d3a', (t - 0.75) / 0.25)
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = hex(a)
  const pb = hex(b)
  const ch = pa.map((value, i) => Math.round(value + (pb[i]! - value) * t))
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function hex(color: string): [number, number, number] {
  const n = color.replace('#', '')
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

function clampUnit(n: number): number {
  return Math.max(-0.92, Math.min(0.92, n))
}

function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
