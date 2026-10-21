import type { Component, EdgeStyle, FlowHop, Scenario, Scene, SimResult, SimSample, SimStep } from './types.ts'
import { clamp } from './format.ts'

/**
 * Illustrative discrete-time model. It shows where pressure goes.
 * It is not a capacity plan — the HUD says so on every readout.
 *
 * Load is a one-second ramp. A queue's drain is the sum of its consumers.
 * Sync parents still "want" the full offered rate; the bottleneck is the
 * component whose own cap is exceeded first.
 */

type Visit = {
  id: string
  via?: string
  style?: EdgeStyle
  latencyMs: number
  async: boolean
  children: Visit[]
}

export function simulate(scene: Scene, scenario: Scenario): SimResult {
  const entry = scene.components.find((c) => c.id === scenario.entry)
  if (!entry) throw new Error(`No entry component ${scenario.entry}.`)
  const faults = new Map((scenario.faults ?? []).map((f) => [f.component, f]))
  const tree = walk(scene, scenario.entry, undefined, undefined, false, [], faults)
  const hops = flatten(tree, 0, true)
  const baselineMs = syncTime(tree)
  const durationS = clamp(scenario.durationS ?? 30, 1, 120)
  const rps = clamp(scenario.rps ?? (scenario.mode === 'load' ? 500 : 1), 0.1, 100_000)
  const samples = scenario.mode === 'load' ? runLoad(scene, scenario.entry, rps, durationS, faults) : []
  const summary = summarise(scene, scenario, hops, baselineMs, samples, rps, durationS, faults)
  const steps = buildSteps(scene, scenario, hops)
  return {
    illustrative: true,
    mode: scenario.mode,
    entry: scenario.entry,
    scenario,
    hops,
    steps,
    samples,
    summary,
  }
}

function walk(
  scene: Scene,
  id: string,
  via: string | undefined,
  style: EdgeStyle | undefined,
  asyncEdge: boolean,
  stack: string[],
  faults: Map<string, NonNullable<Scenario['faults']>[number]>,
): Visit {
  const component = scene.components.find((c) => c.id === id)
  const latencyMs = component ? Math.round(component.behaviour.latencyMs * faultFactor(faults.get(id))) : 0
  if (stack.includes(id) || !component) {
    return { id, via, style, latencyMs: 0, async: true, children: [] }
  }
  const children = scene.edges
    .filter((e) => e.from === id)
    .map((e) => walk(scene, e.to, e.id, e.style, e.style !== 'sync', [...stack, id], faults))
  return { id, via, style, latencyMs, async: asyncEdge, children }
}

function syncTime(node: Visit): number {
  const syncChildren = node.children.filter((child) => !child.async)
  const nested = syncChildren.map(syncTime)
  return node.latencyMs + (nested.length ? Math.max(...nested) : 0)
}

function flatten(node: Visit, atMs: number, parentCritical: boolean): FlowHop[] {
  const critical = parentCritical && !node.async
  const hop: FlowHop = {
    id: node.id,
    via: node.via,
    style: node.style,
    latencyMs: node.latencyMs,
    atMs,
    critical,
    label: node.style,
  }
  const syncChildren = node.children.filter((child) => !child.async)
  const asyncChildren = node.children.filter((child) => child.async)
  const ranked = [...syncChildren].sort((a, b) => syncTime(b) - syncTime(a))
  const nextAt = atMs + node.latencyMs
  const criticalChild = ranked[0]
  const rest = [
    ...ranked.slice(1).flatMap((child) => flatten(child, nextAt, false)),
    ...asyncChildren.flatMap((child) => flatten(child, nextAt, false)),
  ]
  const criticalRest = criticalChild ? flatten(criticalChild, nextAt, critical) : []
  return [hop, ...criticalRest, ...rest]
}

function faultFactor(fault: NonNullable<Scenario['faults']>[number] | undefined): number {
  if (!fault) return 1
  if (fault.mode === 'slow') return fault.factor ?? 4
  if (fault.mode === 'timeout') return fault.factor ?? 8
  return 1
}

function ownCap(component: Component, fault: NonNullable<Scenario['faults']>[number] | undefined): number {
  if (fault?.mode === 'down') return 0
  let serviceSec = Math.max(0.001, (component.behaviour.latencyMs / 1000) * faultFactor(fault))
  if (fault?.mode === 'throttled') serviceSec *= 1
  const concurrency =
    component.behaviour.concurrency ??
    Math.max(1, Math.ceil(component.behaviour.capacityRps * (component.behaviour.latencyMs / 1000)))
  let cap = Math.min(component.behaviour.capacityRps, concurrency / serviceSec)
  if (fault?.mode === 'throttled') cap *= fault.factor ? 1 / fault.factor : 0.3
  return Math.max(0, cap)
}

function nodeCap(
  scene: Scene,
  component: Component,
  faults: Map<string, NonNullable<Scenario['faults']>[number]>,
): number {
  if (component.kind === 'queue') {
    const consumers = scene.edges
      .filter((e) => e.from === component.id)
      .map((e) => scene.components.find((c) => c.id === e.to))
      .filter((c): c is Component => Boolean(c))
    if (consumers.length) {
      return consumers.reduce((sum, consumer) => sum + ownCap(consumer, faults.get(consumer.id)), 0)
    }
  }
  return ownCap(component, faults.get(component.id))
}

function desiredRates(scene: Scene, entry: string, offered: number): Record<string, number> {
  const rates: Record<string, number> = {}
  const queue: { id: string; rate: number; depth: number }[] = [{ id: entry, rate: offered, depth: 0 }]
  const visits = new Map<string, number>()
  while (queue.length) {
    const current = queue.shift()!
    if (current.rate <= 0 || current.depth > 12) continue
    const seen = visits.get(current.id) ?? 0
    if (seen > 2) continue
    visits.set(current.id, seen + 1)
    rates[current.id] = (rates[current.id] ?? 0) + current.rate
    const component = scene.components.find((c) => c.id === current.id)
    if (!component) continue
    for (const edge of scene.edges.filter((e) => e.from === current.id)) {
      let rate = current.rate
      if (component.kind === 'cache' && edge.style === 'sync') {
        rate *= 1 - (component.behaviour.hitRate ?? 0.7)
      }
      // Retries and dead-letters see failures, not every request.
      if (edge.style !== 'sync' && /retry|backoff|dlq|dead/.test(`${edge.label ?? ''} ${edge.to}`)) {
        rate *= 0.08
      }
      queue.push({ id: edge.to, rate, depth: current.depth + 1 })
    }
  }
  return rates
}

function runLoad(
  scene: Scene,
  entry: string,
  rps: number,
  durationS: number,
  faults: Map<string, NonNullable<Scenario['faults']>[number]>,
): SimSample[] {
  const samples: SimSample[] = []
  const queueDepth: Record<string, number> = {}
  let failed = 0
  let completed = 0
  for (let t = 1; t <= durationS; t++) {
    const offered = rps * (t / durationS)
    const desired = desiredRates(scene, entry, offered)
    const util: Record<string, number> = {}
    const queues: Record<string, number> = {}
    let retries = 0
    for (const component of scene.components) {
      const want = desired[component.id] ?? 0
      const cap = Math.max(0.001, nodeCap(scene, component, faults))
      const raw = want / cap
      util[component.id] = raw
      const excess = Math.max(0, want - cap)
      queueDepth[component.id] = (queueDepth[component.id] ?? 0) + excess
      const timeoutSec = component.kind === 'gateway' ? 4 : 8
      const wait = queueDepth[component.id]! / cap
      if (wait > timeoutSec) {
        const overflow = queueDepth[component.id]! - cap * timeoutSec
        failed += overflow
        queueDepth[component.id] = cap * timeoutSec
      }
      queues[component.id] = queueDepth[component.id] ?? 0
      if (component.behaviour.retry && raw > 0.9) {
        retries += want * 0.15 * (component.behaviour.retry.attempts - 1)
      }
      completed += Math.min(want, cap)
    }
    samples.push({
      t,
      util,
      queue: queues,
      failed,
      completed,
      offered,
      retries,
    })
  }
  return samples
}

function summarise(
  scene: Scene,
  scenario: Scenario,
  hops: FlowHop[],
  baselineMs: number,
  samples: SimSample[],
  rps: number,
  durationS: number,
  faults: Map<string, NonNullable<Scenario['faults']>[number]>,
): SimResult['summary'] {
  const last = samples[samples.length - 1]
  const sync = syncClosure(scene, scenario.entry)
  let bottleneck = scenario.entry
  let bottleneckUtil = 0
  if (last) {
    const desired = desiredRates(scene, scenario.entry, rps)
    const rank = (ids: Set<string>) => {
      let best = ''
      let bestRaw = -1
      for (const id of ids) {
        const component = scene.components.find((c) => c.id === id)
        if (!component) continue
        const cap = nodeCap(scene, component, faults)
        const raw = cap > 0 ? (desired[id] ?? 0) / cap : 0
        if (raw > bestRaw) {
          best = id
          bestRaw = raw
        }
      }
      return { id: best, raw: bestRaw }
    }
    const onPath = rank(sync)
    const everywhere = rank(new Set(scene.components.map((c) => c.id)))
    const chosen = onPath.raw >= 1 || onPath.raw >= everywhere.raw ? onPath : everywhere
    bottleneck = chosen.id || scenario.entry
    bottleneckUtil = Math.max(0, chosen.raw)
  } else {
    const slowest = [...hops].sort((a, b) => b.latencyMs - a.latencyMs)[0]
    bottleneck = slowest?.id ?? scenario.entry
    bottleneckUtil = 0
  }

  let firstBreak: SimResult['summary']['firstBreak']
  for (const sample of samples) {
    let hotId = ''
    let hotRaw = 0
    for (const id of sync) {
      const raw = sample.util[id] ?? 0
      if (raw >= 1 && raw > hotRaw) {
        hotId = id
        hotRaw = raw
      }
    }
    if (!hotId) continue
    const component = scene.components.find((c) => c.id === hotId)
    const workers = component?.behaviour.concurrency
    firstBreak = {
      component: hotId,
      atS: sample.t,
      reason: workers
        ? `${workers} workers saturated at T+${sample.t}s. Upstream retries pile on; the gateway waits on the sync path.`
        : `Saturated at T+${sample.t}s. The sync path waits here first.`,
    }
    break
  }

  const queueComponent = last
    ? Object.entries(last.queue).sort((a, b) => b[1] - a[1])[0]
    : undefined
  const cache = scene.components.find((c) => c.kind === 'cache' && hops.some((h) => h.id === c.id))
  const totalOffered = samples.reduce((sum, sample) => sum + sample.offered, 0)
  const failedPct = last && totalOffered > 0 ? (last.failed / totalOffered) * 100 : 0
  const queueWaitMs = firstBreak ? Math.min(8000, (last?.queue[bottleneck] ?? 0) / Math.max(1, rps) * 1000) : 0
  const achievable = last ? Math.min(rps, nodeCap(scene, scene.components.find((c) => c.id === bottleneck)!, faults)) : rps
  const events = (samples.length ? eventsFrom(samples, firstBreak) : []).slice(0, 4)

  return {
    e2eP50Ms: Math.round(baselineMs + queueWaitMs),
    baselineMs: Math.round(baselineMs),
    throughputRps: Math.round(scenario.mode === 'load' ? achievable : rps),
    offeredRps: Math.round(rps),
    failedPct: scenario.mode === 'load' ? Math.round(failedPct * 10) / 10 : 0,
    bottleneck,
    bottleneckUtil,
    firstBreak,
    cacheHitPct: cache?.behaviour.hitRate !== undefined ? Math.round(cache.behaviour.hitRate * 100) : undefined,
    queueDepth: Math.round(queueComponent?.[1] ?? 0),
    queueComponent: queueComponent && queueComponent[1] > 1 ? queueComponent[0] : undefined,
    events,
  }
}

function syncClosure(scene: Scene, entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const id = queue.shift()
    if (!id || seen.has(id)) continue
    seen.add(id)
    for (const edge of scene.edges) {
      if (edge.from === id && edge.style === 'sync') queue.push(edge.to)
    }
  }
  return seen
}

function eventsFrom(samples: SimSample[], firstBreak: SimResult['summary']['firstBreak']): SimResult['summary']['events'] {
  const events: SimResult['summary']['events'] = []
  const rising = samples.find((sample) => Object.values(sample.queue).some((depth) => depth > 10))
  if (rising) events.push({ atS: rising.t, label: `T+${rising.t} queue rising` })
  if (firstBreak) events.push({ atS: firstBreak.atS, label: `T+${firstBreak.atS} ${firstBreak.component} saturated` })
  const later = samples.find((sample) => sample.t > (firstBreak?.atS ?? 0) + 4 && sample.failed > 0)
  if (later) events.push({ atS: later.t, label: `T+${later.t} timeouts begin` })
  if (!events.length && samples[0]) events.push({ atS: samples[0].t, label: 'steady' })
  return events
}

function buildSteps(scene: Scene, scenario: Scenario, hops: FlowHop[]): SimStep[] {
  if (scenario.mode === 'step' && scenario.machineId) {
    const component = scene.components.find((c) => c.id === scenario.machineId && c.machine)
    if (component?.machine) {
      const machine = component.machine
      return machine.states.map((state, index) => {
        const transition = machine.transitions.find((item) => item.from === state.id)
        return {
          id: state.id,
          label: state.label,
          detail: transition ? `${transition.on} → ${transition.to}` : index === 0 ? 'initial' : 'end',
          componentId: component.id,
        }
      })
    }
  }
  const ordered = [...hops.filter((hop) => hop.critical), ...hops.filter((hop) => !hop.critical)]
  const seen = new Set<string>()
  const steps: SimStep[] = []
  for (const hop of ordered) {
    if (seen.has(hop.id + (hop.via ?? ''))) continue
    seen.add(hop.id + (hop.via ?? ''))
    const component = scene.components.find((c) => c.id === hop.id)
    const edge = scene.edges.find((e) => e.id === hop.via)
    steps.push({
      id: hop.id,
      label: component?.label ?? hop.id,
      detail: edge?.label ?? `${hop.style ?? 'entry'} · ${hop.latencyMs} ms`,
      componentId: hop.id,
    })
  }
  return steps
}
