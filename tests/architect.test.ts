import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { planTurn } from '../server/architect.ts'
import { applyPatches, logDecision } from '../shared/patch.ts'
import { emptyScene, type Scene } from '../shared/types.ts'
import { simulate } from '../shared/simulate.ts'
import { toolDefinitions } from '../server/tools.ts'
import { sanitizeRenderHtml } from '../server/renders.ts'
import { SessionStore } from '../server/store.ts'
import { scenePng } from '../server/diagram.ts'
import { buildPublishScene } from '../shared/publish-flow.ts'

function applyPlan(scene: Scene, text: string, mode: 'blank' | 'grounded' = 'grounded') {
  const plan = planTurn({ text, scene, mode })
  let next = scene
  for (const batch of plan.batches) {
    const applied = applyPatches(next, batch.ops)
    if (!applied.ok) throw new Error(applied.issues.map((issue) => issue.message).join(' '))
    next = applied.scene
  }
  for (const decision of [...(plan.decisions ?? []), ...(plan.decision ? [plan.decision] : [])]) {
    const logged = logDecision(next, {
      ...decision,
      affects: decision.affects.filter((id) => next.components.some((c) => c.id === id)),
    })
    if (!logged.ok) throw new Error(logged.message)
    next = logged.scene
  }
  return { plan, scene: next }
}

describe('demo architect', () => {
  it('walks the publish-flow script the demo will use', () => {
    let scene = emptyScene('Publish flow v2 — async compile')
    scene = applyPlan(scene, 'Load the publish flow as it is today').scene
    expect(scene.components.map((c) => c.id)).toEqual(
      expect.arrayContaining(['web-client', 'api-gateway', 'build-service', 'build-store', 'compile-service', 'package-registry', 'release-service']),
    )
    expect(scene.components.some((c) => c.id === 'artifact-cache')).toBe(false)

    scene = applyPlan(scene, 'Put an artifact cache in front of the registry').scene
    expect(scene.components.some((c) => c.id === 'artifact-cache')).toBe(true)
    expect(scene.edges.some((e) => e.id === 'e-compile-registry')).toBe(false)

    scene = applyPlan(scene, 'Emit BuildFinished as an event').scene
    expect(scene.edges.some((e) => e.label === 'BuildFinished')).toBe(true)
    expect(scene.edges.some((e) => e.id === 'e-store-release')).toBe(false)

    scene = applyPlan(scene, 'Add a retry worker with backoff, then a dead letter').scene
    expect(scene.components.some((c) => c.id === 'retry-worker')).toBe(true)
    expect(scene.components.some((c) => c.id === 'dead-letter')).toBe(true)

    const flow = applyPlan(scene, 'Walk a publish request through it and tell me where the time goes')
    expect(flow.plan.simulation).toMatchObject({ mode: 'flow', entry: 'web-client' })
    const traced = simulate(scene, { mode: 'flow', entry: 'web-client' })
    expect(traced.hops.some((hop) => hop.id === 'package-registry')).toBe(true)

    const load = applyPlan(scene, 'What happens at 500 rps if the compile service is slow?')
    expect(load.plan.simulation).toMatchObject({
      mode: 'load',
      rps: 500,
      faults: [{ component: 'compile-service', mode: 'slow', factor: 4 }],
    })
    expect(load.plan.view).toBe('warroom')

    scene = applyPlan(scene, 'Bulkhead the registry call to 32 workers').scene
    expect(scene.components.find((c) => c.id === 'compile-service')?.behaviour.concurrency).toBe(32)
    expect(scene.decisions[0]?.chose).toMatch(/32 workers/)

    scene = applyPlan(scene, 'Should the cache key include the lockfile hash?').scene
    expect(scene.openQuestions.some((q) => /lockfile/i.test(q))).toBe(true)

    const written = applyPlan(scene, 'Write it up')
    expect(written.plan.writeUp).toBe(true)
  })

  it('assembles the mockup scene in eight versions', () => {
    const { scene, plan } = applyPlan(emptyScene('Publish flow v2'), 'Assemble the publish flow demo')
    expect(plan.batches).toHaveLength(8)
    expect(scene.version).toBe(8)
    expect(scene.components.find((c) => c.id === 'compile-service')?.behaviour.concurrency).toBe(32)
    expect(scene.decisions.length).toBeGreaterThanOrEqual(5)
    expect(scene.openQuestions).toHaveLength(3)
  })

  it('builds a blank-slate review sketch from a spoken list', () => {
    const { scene } = applyPlan(
      emptyScene('Reviews'),
      'Add a web client, an API gateway, and a review service',
      'blank',
    )
    expect(scene.components.map((c) => c.id)).toEqual(['web-client', 'api-gateway', 'review-service'])
    expect(scene.edges).toHaveLength(2)
  })

  it('keeps read_shape off the blank-slate tool list', () => {
    expect(toolDefinitions('blank').map((tool) => tool.name)).not.toContain('read_shape')
    expect(toolDefinitions('grounded').map((tool) => tool.name)).toContain('read_shape')
    expect(toolDefinitions('grounded').map((tool) => tool.name)).not.toContain('query_logs')
  })

  it('strips network access from a tier 2 render', () => {
    const cleaned = sanitizeRenderHtml('<html><head></head><body><script>fetch("https://evil.example")</script></body></html>')
    expect(cleaned.stripped).toBe(true)
    expect(cleaned.html).not.toContain('https://evil.example')
    expect(cleaned.html).toContain('Content-Security-Policy')
  })

  it('round-trips a session and writes a PNG signature', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jarvis-'))
    const store = new SessionStore(dir)
    await store.init()
    const session = await store.create({ title: 'Round trip', mode: 'blank' })
    const applied = await store.applyOps(session, [{ op: 'add', component: { id: 'api', kind: 'service', label: 'API' } }], 'Added API')
    expect(applied.ok).toBe(true)
    await store.save(session)
    const again = await store.get(session.id)
    expect(again?.scene.components[0]?.id).toBe('api')
    const png = scenePng(buildPublishScene(3).scene)
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  })
})
