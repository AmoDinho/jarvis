import { describe, expect, it } from 'vitest'
import { emptyScene } from '../shared/types.ts'
import { applyPatches, logDecision } from '../shared/patch.ts'
import { buildPublishScene } from '../shared/publish-flow.ts'

describe('patch engine', () => {
  it('adds, connects, focuses and bumps the version once per batch', () => {
    const applied = applyPatches(emptyScene('Publish flow'), [
      {
        op: 'add',
        component: { id: 'Build Service', kind: 'service', label: 'Build service' },
      },
      {
        op: 'add',
        component: { id: 'web-client', kind: 'client', label: 'Web client' },
      },
      { op: 'connect', edge: { from: 'web-client', to: 'build-service', style: 'sync', label: 'POST /builds' } },
      { op: 'focus', id: 'build-service' },
    ])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.scene.version).toBe(1)
    expect(applied.scene.components.map((c) => c.id)).toEqual(['build-service', 'web-client'])
    expect(applied.scene.focus).toBe('build-service')
    expect(applied.scene.edges[0]?.label).toBe('POST /builds')
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
    const { scene } = buildPublishScene(3)
    const before = scene.components.find((c) => c.id === 'compile-service')!
    const applied = applyPatches(scene, [
      { op: 'update', id: 'compile-service', patch: { behaviour: { concurrency: 32 } } },
    ])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const after = applied.scene.components.find((c) => c.id === 'compile-service')!
    expect(after.behaviour.concurrency).toBe(32)
    expect(after.behaviour.latencyMs).toBe(before.behaviour.latencyMs)
    expect(applied.applied[0]?.detail).toContain('64 → 32')
    expect(applied.scene.version).toBe(scene.version + 1)
  })

  it('removes a component and its edges, and keeps one focus', () => {
    const { scene } = buildPublishScene(2)
    const applied = applyPatches(scene, [{ op: 'remove', id: 'build-store' }])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.scene.components.some((c) => c.id === 'build-store')).toBe(false)
    expect(applied.scene.edges.some((e) => e.from === 'build-store' || e.to === 'build-store')).toBe(false)
    expect(applied.scene.focus).toBeTruthy()
  })

  it('logs a decision without inventing components', () => {
    const { scene } = buildPublishScene(3)
    const logged = logDecision(scene, {
      chose: 'Split compile out of build service',
      because: 'Compile changes weekly, the build API rarely',
      affects: ['compile-service'],
      rejected: ['Keep one service'],
    })
    expect(logged.ok).toBe(true)
    if (!logged.ok) return
    expect(logged.decision.id).toBe('d-001')
    expect(logged.scene.decisions[0]?.chose).toMatch(/Split compile/)
    const bad = logDecision(scene, { chose: 'x', because: 'y', affects: ['nope'] })
    expect(bad.ok).toBe(false)
  })

  it('tidies onto unique grid cells', () => {
    const { scene } = buildPublishScene(7)
    const applied = applyPatches(scene, [{ op: 'tidy' }])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const cells = applied.scene.components.map((c) => c.position?.join(','))
    expect(new Set(cells).size).toBe(cells.length)
    expect(cells.every(Boolean)).toBe(true)
  })
})
