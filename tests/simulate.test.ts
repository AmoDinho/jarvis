import { describe, expect, it } from 'vitest'
import { buildPublishScene } from '../shared/publish-flow.ts'
import { simulate } from '../shared/simulate.ts'
import { narrateSimulation } from '../shared/narrate.ts'

describe('simulation', () => {
  const { scene } = buildPublishScene(7)

  it('traces a publish request and names the slow hop', () => {
    const result = simulate(scene, { mode: 'flow', entry: 'web-client', prompt: 'walk a publish' })
    expect(result.illustrative).toBe(true)
    const ids = result.hops.map((hop) => hop.id)
    expect(ids).toContain('web-client')
    expect(ids).toContain('build-service')
    expect(ids).toContain('compile-service')
    expect(ids).toContain('package-registry')
    expect(result.summary.baselineMs).toBeGreaterThan(400)
    const speech = narrateSimulation(scene, result).join(' ')
    expect(speech.toLowerCase()).toContain('illustrative')
    expect(speech.toLowerCase()).toMatch(/registry|compile/)
  })

  it('saturates compile first when compile is slowed at 500 rps', () => {
    const result = simulate(scene, {
      mode: 'load',
      entry: 'web-client',
      rps: 500,
      durationS: 30,
      faults: [{ component: 'compile-service', mode: 'slow', factor: 4 }],
      prompt: '500 rps, compile slow',
    })
    expect(result.summary.bottleneck).toBe('compile-service')
    expect(result.summary.firstBreak?.component).toBe('compile-service')
    expect(result.summary.firstBreak?.atS).toBeLessThan(20)
    expect(result.samples).toHaveLength(30)
    expect(result.summary.failedPct).toBeGreaterThan(0)
    const speech = narrateSimulation(scene, result).join(' ')
    expect(speech).toMatch(/Compile service saturates first/)
    expect(speech.toLowerCase()).toContain('bulkhead')
  })

  it('does not blame compile when the same load has no fault', () => {
    const result = simulate(scene, {
      mode: 'load',
      entry: 'web-client',
      rps: 500,
      durationS: 30,
    })
    expect(result.summary.bottleneck).not.toBe('compile-service')
  })

  it('steps a state machine when one is present', () => {
    const withMachine = buildPublishScene(5).scene
    const patched = {
      ...withMachine,
      components: withMachine.components.map((component) =>
        component.id === 'release-service'
          ? {
              ...component,
              machine: {
                initial: 'draft',
                states: [
                  { id: 'draft', label: 'Draft' },
                  { id: 'staged', label: 'Staged' },
                ],
                transitions: [{ from: 'draft', to: 'staged', on: 'Promote' }],
              },
            }
          : component,
      ),
    }
    const result = simulate(patched, { mode: 'step', entry: 'release-service', machineId: 'release-service' })
    expect(result.steps.map((step) => step.label)).toEqual(['Draft', 'Staged'])
    expect(result.steps[0]?.detail).toContain('Promote')
  })
})
