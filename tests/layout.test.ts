import { describe, expect, it } from 'vitest'
import { emptyScene } from '../shared/types.ts'
import { applyPatches } from '../shared/patch.ts'
import { constellationLayout, isoLayout, orbitalLayout, packGrid } from '../shared/layout.ts'

describe('layout', () => {
  it('places 24 components without NaN and without stacked grid cells', () => {
    let scene = emptyScene('wide')
    const ops = []
    for (let i = 0; i < 24; i++) {
      const group = ['quoting', 'policy', 'edge', 'external'][i % 4]!
      ops.push({
        op: 'add' as const,
        component: {
          id: `svc-${i}`,
          kind: 'service' as const,
          label: `Service ${i}`,
          group,
        },
      })
    }
    for (let i = 1; i < 24; i++) {
      ops.push({
        op: 'connect' as const,
        edge: { from: `svc-${i - 1}`, to: `svc-${i}`, style: 'sync' as const },
      })
    }
    const applied = applyPatches(scene, ops)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    scene = applied.scene
    const orbital = orbitalLayout(scene)
    const constellation = constellationLayout(scene)
    const iso = isoLayout(scene)
    expect(Object.keys(orbital)).toHaveLength(24)
    for (const point of Object.values(orbital)) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
    expect(Object.keys(constellation)).toHaveLength(24)
    const cells = Object.values(packGrid(scene)).map(([x, y]) => `${x},${y}`)
    expect(new Set(cells).size).toBe(24)
    expect(Object.values(iso).every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true)
  })
})
