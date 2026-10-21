import { describe, expect, it } from 'vitest'
import { buildQuoteScene } from '../shared/quote-flow.ts'
import { simulate } from '../shared/simulate.ts'
import { narrateSimulation } from '../shared/narrate.ts'

describe('simulation', () => {
  const { scene } = buildQuoteScene(7)

  it('traces a quote request and names the slow hop', () => {
    const result = simulate(scene, { mode: 'flow', entry: 'web-client', prompt: 'walk a quote' })
    expect(result.illustrative).toBe(true)
    const ids = result.hops.map((hop) => hop.id)
    expect(ids).toContain('web-client')
    expect(ids).toContain('quote-service')
    expect(ids).toContain('rating-service')
    expect(ids).toContain('rating-partner')
    expect(result.summary.baselineMs).toBeGreaterThan(400)
    const speech = narrateSimulation(scene, result).join(' ')
    expect(speech.toLowerCase()).toContain('illustrative')
    expect(speech.toLowerCase()).toMatch(/partner|rating/)
  })

  it('saturates rating first when rating is slowed at 500 rps', () => {
    const result = simulate(scene, {
      mode: 'load',
      entry: 'web-client',
      rps: 500,
      durationS: 30,
      faults: [{ component: 'rating-service', mode: 'slow', factor: 4 }],
      prompt: '500 rps, rating slow',
    })
    expect(result.summary.bottleneck).toBe('rating-service')
    expect(result.summary.firstBreak?.component).toBe('rating-service')
    expect(result.summary.firstBreak?.atS).toBeLessThan(20)
    expect(result.samples).toHaveLength(30)
    expect(result.summary.failedPct).toBeGreaterThan(0)
    const speech = narrateSimulation(scene, result).join(' ')
    expect(speech).toMatch(/Rating service saturates first/)
    expect(speech.toLowerCase()).toContain('bulkhead')
  })

  it('does not blame rating when the same load has no fault', () => {
    const result = simulate(scene, {
      mode: 'load',
      entry: 'web-client',
      rps: 500,
      durationS: 30,
    })
    expect(result.summary.bottleneck).not.toBe('rating-service')
  })

  it('steps a state machine when one is present', () => {
    const withMachine = buildQuoteScene(5).scene
    const patched = {
      ...withMachine,
      components: withMachine.components.map((component) =>
        component.id === 'policy-service'
          ? {
              ...component,
              machine: {
                initial: 'draft',
                states: [
                  { id: 'draft', label: 'Draft' },
                  { id: 'bound', label: 'Bound' },
                ],
                transitions: [{ from: 'draft', to: 'bound', on: 'Bind' }],
              },
            }
          : component,
      ),
    }
    const result = simulate(patched, { mode: 'step', entry: 'policy-service', machineId: 'policy-service' })
    expect(result.steps.map((step) => step.label)).toEqual(['Draft', 'Bound'])
    expect(result.steps[0]?.detail).toContain('Bind')
  })
})
