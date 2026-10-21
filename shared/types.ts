/**
 * Scene model — the single source of truth.
 * Diagram, simulation, voice walkthrough and spec all read from this.
 * Required fields match the v0.1 spec. Optional fields are shape-only
 * extensions (never live values) so the views can stay in agreement.
 */

export type ComponentKind =
  | 'service'
  | 'queue'
  | 'store'
  | 'cache'
  | 'gateway'
  | 'client'
  | 'external'
  | 'function'

export type EdgeStyle = 'sync' | 'async' | 'event' | 'stream'

export type Behaviour = {
  latencyMs: number
  capacityRps: number
  concurrency?: number
  retry?: { attempts: number; backoffMs: number }
  failureModes: string[]
  /** Cache only. Illustrative hit ratio, not a measured production metric. */
  hitRate?: number
}

export type StateMachine = {
  initial: string
  states: { id: string; label: string }[]
  transitions: { from: string; to: string; on: string }[]
}

/** Code structure only: paths, type names, field names. Never example values. */
export type ShapeInfo = {
  path?: string
  signature?: string
  fields?: string[]
}

export type Component = {
  id: string
  kind: ComponentKind
  label: string
  group?: string
  /** Grid cell. Auto-laid out when absent. */
  position?: [number, number]
  behaviour: Behaviour
  notes?: string
  shape?: ShapeInfo
  machine?: StateMachine
}

export type Edge = {
  id: string
  from: string
  to: string
  style: EdgeStyle
  label?: string
}

export type Decision = {
  id: string
  at: string
  chose: string
  rejected?: string[]
  because: string
  affects: string[]
}

/** Decorative file/type stars for constellation view. Paths only. */
export type Satellite = {
  id: string
  label: string
  group: string
}

export type Scene = {
  version: number
  title: string
  components: Component[]
  edges: Edge[]
  decisions: Decision[]
  openQuestions: string[]
  /** Id of the one lit component. */
  focus?: string
  satellites?: Satellite[]
}

export type ComponentPatch = {
  label?: string
  kind?: ComponentKind
  group?: string | null
  position?: [number, number] | null
  notes?: string | null
  behaviour?: Partial<Behaviour>
  shape?: ShapeInfo | null
  machine?: StateMachine | null
}

export type PatchOp =
  | { op: 'add'; component: Partial<Component> & Pick<Component, 'id' | 'kind' | 'label'> }
  | { op: 'update'; id: string; patch: ComponentPatch }
  | { op: 'remove'; id: string }
  | { op: 'connect'; edge: Partial<Edge> & Pick<Edge, 'from' | 'to' | 'style'> }
  | { op: 'disconnect'; id?: string; from?: string; to?: string }
  | { op: 'focus'; id: string | null }
  | { op: 'retitle'; title: string }
  | { op: 'question'; text: string }
  | { op: 'resolve_question'; text: string }
  | { op: 'satellites'; satellites: Satellite[] }
  | { op: 'tidy' }

export type FaultMode = 'slow' | 'down' | 'throttled' | 'timeout'

export type Scenario = {
  mode: 'flow' | 'load' | 'step'
  entry: string
  rps?: number
  durationS?: number
  faults?: { component: string; mode: FaultMode; factor?: number }[]
  /** When set, step mode walks this component's state machine. */
  machineId?: string
  prompt?: string
}

export type FlowHop = {
  id: string
  via?: string
  style?: EdgeStyle
  latencyMs: number
  atMs: number
  critical: boolean
  label?: string
}

export type SimStep = {
  id: string
  label: string
  detail: string
  componentId?: string
}

export type SimSample = {
  t: number
  util: Record<string, number>
  queue: Record<string, number>
  failed: number
  completed: number
  offered: number
  retries: number
}

export type SimEvent = { atS: number; label: string }

export type SimResult = {
  illustrative: true
  mode: Scenario['mode']
  entry: string
  scenario: Scenario
  hops: FlowHop[]
  steps: SimStep[]
  samples: SimSample[]
  summary: {
    e2eP50Ms: number
    baselineMs: number
    throughputRps: number
    offeredRps: number
    failedPct: number
    bottleneck: string
    bottleneckUtil: number
    firstBreak?: { component: string; atS: number; reason: string }
    cacheHitPct?: number
    queueDepth: number
    queueComponent?: string
    events: SimEvent[]
  }
}

export type ActivityStatus =
  | 'validated'
  | 'decision'
  | 'simulation'
  | 'render_queued'
  | 'rejected'

export type Activity = {
  id: string
  at: string
  version: number | null
  tool: 'patch_scene' | 'log_decision' | 'run_simulation' | 'render' | 'writeup'
  action: string
  target: string
  detail: string
  status: ActivityStatus
}

export type RenderTier = 1 | 2 | 3

export type RenderJob = {
  id: string
  tier: RenderTier
  componentId: string
  status: 'queued' | 'ready' | 'kept' | 'failed'
  title: string
  why: string
  createdAt: string
  readyAt?: string
  figure?: string
  file?: string
}

export type ViewName = 'orbital' | 'constellation' | 'warroom' | 'decisions' | 'writeup'

export const COMPONENT_KINDS: ComponentKind[] = [
  'service',
  'queue',
  'store',
  'cache',
  'gateway',
  'client',
  'external',
  'function',
]

export const EDGE_STYLES: EdgeStyle[] = ['sync', 'async', 'event', 'stream']

export function emptyScene(title: string): Scene {
  return {
    version: 0,
    title,
    components: [],
    edges: [],
    decisions: [],
    openQuestions: [],
  }
}

export function cloneScene(scene: Scene): Scene {
  return structuredClone(scene)
}
