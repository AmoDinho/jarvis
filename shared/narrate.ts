import type { Scene, SimResult } from './types.ts'
import { formatMs } from './format.ts'

export function narrateSimulation(scene: Scene, result: SimResult): string[] {
  const name = (id: string) => scene.components.find((c) => c.id === id)?.label ?? id
  if (result.mode === 'flow' || (result.mode === 'step' && !result.scenario.machineId)) {
    const slowest = [...result.hops].sort((a, b) => b.latencyMs - a.latencyMs)[0]
    const where = slowest ? name(slowest.id) : 'the path'
    return [
      `A request from ${name(result.entry)} takes about ${formatMs(result.summary.baselineMs)} on the critical path.`,
      `${where} is where the time goes${slowest ? `, at ${formatMs(slowest.latencyMs)}` : ''}.`,
      'These numbers are illustrative. They show the shape of the delay, not a capacity plan.',
    ]
  }
  if (result.mode === 'step') {
    const component = name(result.scenario.machineId ?? result.entry)
    return [
      `Stepping the ${component} state machine.`,
      'Arrow keys advance one transition. The lit state is the only one that matters.',
      'Nothing here is live. It is the shape of the machine, not a policy record.',
    ]
  }
  const bottleneck = name(result.summary.bottleneck)
  const e2e = formatMs(result.summary.e2eP50Ms)
  const failed = result.summary.failedPct.toFixed(1)
  return [
    `${bottleneck} saturates first.`,
    `End to end sits near ${e2e}, with about ${failed} percent of the illustrative load failing.`,
    mitigation(scene, result),
  ]
}

function mitigation(scene: Scene, result: SimResult): string {
  const id = result.summary.bottleneck
  const component = scene.components.find((c) => c.id === id)
  if (!component) return 'Want me to tidy the scene and re-run?'
  if (id.includes('rating') || id.includes('partner') || component.kind === 'external') {
    return 'Want me to bulkhead the partner call and re-run?'
  }
  if (component.kind === 'queue') return 'The queue is absorbing the spike. Want me to add a consumer and re-run?'
  return `Want me to raise capacity on ${component.label} and re-run?`
}
