import { describe, expect, it } from 'vitest'
import { emptyScene } from '../shared/types.ts'
import { applyPatches, logDecision } from '../shared/patch.ts'
import { buildQuoteScene } from '../shared/quote-flow.ts'

describe('patch engine', () => {
  it('adds, connects, focuses and bumps the version once per batch', () => {
    const applied = applyPatches(emptyScene('Quote flow'), [
      {
        op: 'add',
        component: { id: 'Quote Service', kind: 'service', label: 'Quote service' },
      },
      {
        op: 'add',
        component: { id: 'web-client', kind: 'client', label: 'Web client' },
      },
      { op: 'connect', edge: { from: 'web-client', to: 'quote-service', style: 'sync', label: 'POST /quotes' } },
      { op: 'focus', id: 'quote-service' },
    ])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.scene.version).toBe(1)
    expect(applied.scene.components.map((c) => c.id)).toEqual(['quote-service', 'web-client'])
    expect(applied.scene.focus).toBe('quote-service')
    expect(applied.scene.edges[0]?.label).toBe('POST /quotes')
    expect(applied.scene.components[0]?.behaviour.latencyMs).toBeGreaterThan(0)
  })

  it('rejects the whole batch when one operation is invalid', () => {
    const start = emptyScene('x')
    const applied = applyPatches(start, [
      { op: 'add', component: { id: 'api', kind: 'service', label: 'API' } },
      { op: 'connect', edge: { from: 'api', to: 'missing', style: 'sync' } },
    ])
    expect(applied.ok).toBe(false)
    if (applied.ok) return
    expect(applied.scene.version).toBe(0)
    expect(applied.scene.components).toHaveLength(0)
    expect(applied.issues[0]?.message).toMatch(/missing/)
  })

  it('updates behaviour without redrawing the component', () => {
    const { scene } = buildQuoteScene(3)
    const before = scene.components.find((c) => c.id === 'rating-service')!
    const applied = applyPatches(scene, [
      { op: 'update', id: 'rating-service', patch: { behaviour: { concurrency: 32 } } },
    ])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const after = applied.scene.components.find((c) => c.id === 'rating-service')!
    expect(after.behaviour.concurrency).toBe(32)
    expect(after.behaviour.latencyMs).toBe(before.behaviour.latencyMs)
    expect(applied.applied[0]?.detail).toContain('64 → 32')
    expect(applied.scene.version).toBe(scene.version + 1)
  })

  it('removes a component and its edges, and keeps one focus', () => {
    const { scene } = buildQuoteScene(2)
    const applied = applyPatches(scene, [{ op: 'remove', id: 'quote-store' }])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.scene.components.some((c) => c.id === 'quote-store')).toBe(false)
    expect(applied.scene.edges.some((e) => e.from === 'quote-store' || e.to === 'quote-store')).toBe(false)
    expect(applied.scene.focus).toBeTruthy()
  })

  it('logs a decision without inventing components', () => {
    const { scene } = buildQuoteScene(3)
    const logged = logDecision(scene, {
      chose: 'Split rating out of quote service',
      because: 'Rating changes weekly, quoting rarely',
      affects: ['rating-service'],
      rejected: ['Keep one service'],
    })
    expect(logged.ok).toBe(true)
    if (!logged.ok) return
    expect(logged.decision.id).toBe('d-001')
    expect(logged.scene.decisions[0]?.chose).toMatch(/Split rating/)
    const bad = logDecision(scene, { chose: 'x', because: 'y', affects: ['nope'] })
    expect(bad.ok).toBe(false)
  })

  it('tidies onto unique grid cells', () => {
    const { scene } = buildQuoteScene(7)
    const applied = applyPatches(scene, [{ op: 'tidy' }])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const cells = applied.scene.components.map((c) => c.position?.join(','))
    expect(new Set(cells).size).toBe(cells.length)
    expect(cells.every(Boolean)).toBe(true)
  })
})
