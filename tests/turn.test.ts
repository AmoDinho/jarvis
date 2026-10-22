import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ServerEvent } from '../shared/session.ts'
import { config } from '../server/config.ts'
import { Orchestrator } from '../server/orchestrator.ts'
import { SessionStore } from '../server/store.ts'

describe('demo turn pipeline', () => {
  it('loads a flow, runs load, and writes a spec', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jarvis-turn-'))
    const store = new SessionStore(dir)
    await store.init()
    const events: ServerEvent[] = []
    const orchestrator = new Orchestrator(store, (_id, event) => events.push(event), {
      ...config(),
      brain: 'demo',
      sessionsDir: dir,
      apiKey: '',
    })
    const session = await store.create({ title: 'Publish flow v2 — async compile', mode: 'grounded' })

    await orchestrator.turn(session, 'Load the publish flow as it is today')
    expect(session.scene.components.map((c) => c.id)).toEqual(
      expect.arrayContaining(['web-client', 'build-service', 'compile-service', 'package-registry']),
    )
    expect(events.some((event) => event.type === 'speech.sentence')).toBe(true)
    expect(events.some((event) => event.type === 'view' && event.view === 'constellation')).toBe(true)

    await orchestrator.turn(session, 'What happens at 500 rps if the compile service is slow?')
    expect(session.simulations[0]?.summary.bottleneck).toBe('compile-service')
    expect(session.simulations[0]?.illustrative).toBe(true)

    await orchestrator.turn(session, 'Write it up')
    expect(session.spec?.markdown).toContain('## 1. Summary')
    expect(session.spec?.markdown).toContain('## 7. Evolution')
    expect(session.spec?.markdown.toLowerCase()).not.toContain('customer@')
  }, 20000)
})
