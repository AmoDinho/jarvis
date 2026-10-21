import type { Component, PatchOp, Satellite, Scene } from './types.ts'
import { emptyScene } from './types.ts'
import { applyPatches } from './patch.ts'

export type QuoteStage = {
  id: string
  why: string
  ops: PatchOp[]
}

const policyMachine: NonNullable<Component['machine']> = {
  initial: 'draft',
  states: [
    { id: 'draft', label: 'Draft' },
    { id: 'quoted', label: 'Quoted' },
    { id: 'bound', label: 'Bound' },
    { id: 'active', label: 'Active' },
    { id: 'lapsed', label: 'Lapsed' },
  ],
  transitions: [
    { from: 'draft', to: 'quoted', on: 'QuoteCreated' },
    { from: 'quoted', to: 'bound', on: 'Bind' },
    { from: 'bound', to: 'active', on: 'Inception' },
    { from: 'active', to: 'lapsed', on: 'Term ends' },
    { from: 'lapsed', to: 'quoted', on: 'Reinstatement' },
  ],
}

export const QUOTE_SATELLITES: Satellite[] = [
  { id: 'sat-quote-handler', label: 'apps/quote-service/src/create-quote.ts', group: 'quoting' },
  { id: 'sat-quote-types', label: 'apps/quote-service/src/types.ts', group: 'quoting' },
  { id: 'sat-quote-store', label: 'apps/quote-service/src/store.ts', group: 'quoting' },
  { id: 'sat-rating-handler', label: 'apps/rating-service/src/price-risk.ts', group: 'quoting' },
  { id: 'sat-rating-client', label: 'apps/rating-service/src/partner-client.ts', group: 'quoting' },
  { id: 'sat-cache', label: 'apps/rating-service/src/price-cache.ts', group: 'quoting' },
  { id: 'sat-events', label: 'contracts/events/quote-created.ts', group: 'quoting' },
  { id: 'sat-gateway', label: 'apps/edge/src/routes/quotes.ts', group: 'edge' },
  { id: 'sat-web', label: 'apps/web/src/quote-form.ts', group: 'edge' },
  { id: 'sat-policy', label: 'apps/policy-service/src/bind.ts', group: 'policy' },
  { id: 'sat-policy-state', label: 'apps/policy-service/src/state.ts', group: 'policy' },
  { id: 'sat-partner', label: 'integrations/rating-partner/client.ts', group: 'external' },
]

export const quoteStages: QuoteStage[] = [
  {
    id: 'core',
    why: 'Client, gateway, quote service',
    ops: [
      add('web-client', 'client', 'Web client', 'edge', { latencyMs: 30, capacityRps: 800, failureModes: [] }, 'apps/web'),
      add('api-gateway', 'gateway', 'API gateway', 'edge', {
        latencyMs: 38,
        capacityRps: 1000,
        concurrency: 200,
        failureModes: ['timeout'],
      }, 'apps/edge'),
      add('quote-service', 'service', 'Quote service', 'quoting', {
        latencyMs: 120,
        capacityRps: 300,
        concurrency: 64,
        retry: { attempts: 3, backoffMs: 200 },
        failureModes: ['timeout', 'throttled'],
      }, 'apps/quote-service', 'createQuote(input: QuoteInput): Quote'),
      { op: 'connect', edge: { id: 'e-client-gateway', from: 'web-client', to: 'api-gateway', style: 'sync' } },
      { op: 'connect', edge: { id: 'e-gateway-quote', from: 'api-gateway', to: 'quote-service', style: 'sync', label: 'POST /quotes' } },
      { op: 'focus', id: 'quote-service' },
    ],
  },
  {
    id: 'store',
    why: 'Quote store added',
    ops: [
      add('quote-store', 'store', 'Quote store', 'quoting', { latencyMs: 9, capacityRps: 1000, failureModes: [] }, 'apps/quote-service/src/store.ts'),
      { op: 'connect', edge: { id: 'e-quote-store', from: 'quote-service', to: 'quote-store', style: 'sync' } },
    ],
  },
  {
    id: 'rating',
    why: 'Rating split out',
    ops: [
      add('rating-service', 'service', 'Rating service', 'quoting', {
        latencyMs: 140,
        capacityRps: 400,
        concurrency: 64,
        failureModes: ['timeout'],
      }, 'apps/rating-service', 'price(input: RiskHash): Premium'),
      { op: 'connect', edge: { id: 'e-quote-rating', from: 'quote-service', to: 'rating-service', style: 'sync' } },
    ],
  },
  {
    id: 'partner',
    why: 'Rating partner, external',
    ops: [
      add('rating-partner', 'external', 'Rating partner', 'external', {
        latencyMs: 420,
        capacityRps: 200,
        concurrency: 80,
        failureModes: ['timeout', 'throttled'],
      }, 'integrations/rating-partner'),
      { op: 'connect', edge: { id: 'e-rating-partner', from: 'rating-service', to: 'rating-partner', style: 'sync' } },
    ],
  },
  {
    id: 'domains',
    why: 'Grouped into domains',
    ops: [
      { op: 'update', id: 'web-client', patch: { group: 'edge' } },
      { op: 'update', id: 'api-gateway', patch: { group: 'edge' } },
      { op: 'update', id: 'quote-service', patch: { group: 'quoting' } },
      { op: 'update', id: 'quote-store', patch: { group: 'quoting' } },
      { op: 'update', id: 'rating-service', patch: { group: 'quoting' } },
      add('policy-service', 'service', 'Policy service', 'policy', {
        latencyMs: 80,
        capacityRps: 120,
        concurrency: 16,
        failureModes: ['timeout'],
      }, 'apps/policy-service', 'bind(quoteId: QuoteId): Policy'),
      { op: 'connect', edge: { id: 'e-store-policy', from: 'quote-store', to: 'policy-service', style: 'sync', label: 'poll' } },
      { op: 'focus', id: 'quote-service' },
    ],
  },
  {
    id: 'cache',
    why: 'Pricing cache',
    ops: [
      add('pricing-cache', 'cache', 'Pricing cache', 'quoting', {
        latencyMs: 2,
        capacityRps: 5000,
        hitRate: 0.62,
        failureModes: [],
      }, 'apps/rating-service/src/price-cache.ts', 'get(key: RiskHash): Premium | miss'),
      { op: 'disconnect', id: 'e-rating-partner' },
      { op: 'connect', edge: { id: 'e-rating-cache', from: 'rating-service', to: 'pricing-cache', style: 'sync' } },
      { op: 'connect', edge: { id: 'e-cache-partner', from: 'pricing-cache', to: 'rating-partner', style: 'sync', label: 'miss' } },
    ],
  },
  {
    id: 'events',
    why: 'QuoteCreated event + retry',
    ops: [
      { op: 'disconnect', id: 'e-store-policy' },
      add('quote-events', 'queue', 'Quote events', 'quoting', { latencyMs: 5, capacityRps: 3000, failureModes: [] }, 'contracts/events/quote-created.ts', 'QuoteCreated { quoteId, riskHash }'),
      add('retry-worker', 'function', 'Retry worker', 'quoting', {
        latencyMs: 40,
        capacityRps: 80,
        concurrency: 8,
        retry: { attempts: 3, backoffMs: 200 },
        failureModes: ['timeout'],
      }, 'apps/quote-service/src/retry-worker.ts', 'backoff(attempt): Duration then dead-letter'),
      add('dead-letter', 'queue', 'Dead letter', 'quoting', { latencyMs: 5, capacityRps: 500, failureModes: [] }, 'apps/quote-service/src/dead-letter.ts'),
      { op: 'connect', edge: { id: 'e-quote-events', from: 'quote-service', to: 'quote-events', style: 'event', label: 'QuoteCreated' } },
      { op: 'connect', edge: { id: 'e-events-policy', from: 'quote-events', to: 'policy-service', style: 'event' } },
      { op: 'connect', edge: { id: 'e-events-retry', from: 'quote-events', to: 'retry-worker', style: 'async', label: 'backoff' } },
      { op: 'connect', edge: { id: 'e-retry-dlq', from: 'retry-worker', to: 'dead-letter', style: 'async', label: 'DLQ' } },
    ],
  },
]

export function buildQuoteScene(stageCount = quoteStages.length, title = 'Quote flow v2'): { scene: Scene; notes: { version: number; why: string }[] } {
  let scene = emptyScene(title)
  const notes: { version: number; why: string }[] = []
  for (const stage of quoteStages.slice(0, stageCount)) {
    const applied = applyPatches(scene, stage.ops)
    if (!applied.ok) {
      throw new Error(`Quote stage ${stage.id} failed: ${applied.issues.map((i) => i.message).join('; ')}`)
    }
    scene = applied.scene
    notes.push({ version: scene.version, why: stage.why })
  }
  return { scene, notes }
}

export function opsForCache(scene: Scene): PatchOp[] {
  if (!has(scene, 'rating-service')) return []
  const ops: PatchOp[] = []
  if (!has(scene, 'pricing-cache')) ops.push(quoteStages[5]!.ops[0]!)
  if (scene.edges.some((e) => e.id === 'e-rating-partner')) ops.push({ op: 'disconnect', id: 'e-rating-partner' })
  if (!scene.edges.some((e) => e.id === 'e-rating-cache')) {
    ops.push({ op: 'connect', edge: { id: 'e-rating-cache', from: 'rating-service', to: 'pricing-cache', style: 'sync' } })
  }
  if (has(scene, 'rating-partner') && !scene.edges.some((e) => e.id === 'e-cache-partner')) {
    ops.push({ op: 'connect', edge: { id: 'e-cache-partner', from: 'pricing-cache', to: 'rating-partner', style: 'sync', label: 'miss' } })
  }
  return ops
}

export function opsForEvents(scene: Scene): PatchOp[] {
  const ops: PatchOp[] = []
  if (scene.edges.some((e) => e.id === 'e-store-policy')) ops.push({ op: 'disconnect', id: 'e-store-policy' })
  if (!has(scene, 'quote-events')) ops.push(addOp(quoteStages[6]!, 'quote-events'))
  if (!scene.edges.some((e) => e.from === 'quote-service' && e.to === 'quote-events')) {
    ops.push({ op: 'connect', edge: { id: 'e-quote-events', from: 'quote-service', to: 'quote-events', style: 'event', label: 'QuoteCreated' } })
  }
  if (has(scene, 'policy-service') && !scene.edges.some((e) => e.from === 'quote-events' && e.to === 'policy-service')) {
    ops.push({ op: 'connect', edge: { id: 'e-events-policy', from: 'quote-events', to: 'policy-service', style: 'event' } })
  }
  return ops
}

export function opsForRetry(scene: Scene): PatchOp[] {
  const ops: PatchOp[] = []
  if (!has(scene, 'retry-worker')) ops.push(addOp(quoteStages[6]!, 'retry-worker'))
  if (!has(scene, 'dead-letter')) ops.push(addOp(quoteStages[6]!, 'dead-letter'))
  if (!has(scene, 'quote-events')) ops.push(...opsForEvents(scene))
  if (!scene.edges.some((e) => e.from === 'quote-events' && e.to === 'retry-worker')) {
    ops.push({ op: 'connect', edge: { id: 'e-events-retry', from: 'quote-events', to: 'retry-worker', style: 'async', label: 'backoff' } })
  }
  if (!scene.edges.some((e) => e.from === 'retry-worker' && e.to === 'dead-letter')) {
    ops.push({ op: 'connect', edge: { id: 'e-retry-dlq', from: 'retry-worker', to: 'dead-letter', style: 'async', label: 'DLQ' } })
  }
  return ops
}

export function opsForBulkhead(workers: number): PatchOp[] {
  return [{ op: 'update', id: 'rating-service', patch: { behaviour: { concurrency: workers } } }]
}

export function policyMachinePatch(): PatchOp {
  return { op: 'update', id: 'policy-service', patch: { machine: policyMachine, notes: 'Policy state machine. Shape only.' } }
}

function has(scene: Scene, id: string): boolean {
  return scene.components.some((c) => c.id === id)
}

function addOp(stage: QuoteStage, id: string): PatchOp {
  const op = stage.ops.find((item) => item.op === 'add' && item.component.id === id)
  if (!op || op.op !== 'add') throw new Error(`Missing add ${id}`)
  return op
}

function add(
  id: string,
  kind: Component['kind'],
  label: string,
  group: string,
  behaviour: Component['behaviour'],
  path?: string,
  signature?: string,
): PatchOp {
  return {
    op: 'add',
    component: {
      id,
      kind,
      label,
      group,
      behaviour,
      notes: signature ?? label,
      shape: path || signature ? { path, signature } : undefined,
    },
  }
}
