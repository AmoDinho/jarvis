import type { Component, PatchOp, Satellite, Scene } from './types.ts'
import { emptyScene } from './types.ts'
import { applyPatches } from './patch.ts'

export type PublishStage = {
  id: string
  why: string
  ops: PatchOp[]
}

const releaseMachine: NonNullable<Component['machine']> = {
  initial: 'draft',
  states: [
    { id: 'draft', label: 'Draft' },
    { id: 'packaged', label: 'Packaged' },
    { id: 'staged', label: 'Staged' },
    { id: 'live', label: 'Live' },
    { id: 'rolled-back', label: 'Rolled back' },
  ],
  transitions: [
    { from: 'draft', to: 'packaged', on: 'BuildFinished' },
    { from: 'packaged', to: 'staged', on: 'Promote' },
    { from: 'staged', to: 'live', on: 'GoLive' },
    { from: 'live', to: 'rolled-back', on: 'Rollback' },
    { from: 'rolled-back', to: 'packaged', on: 'Republish' },
  ],
}

export const PUBLISH_SATELLITES: Satellite[] = [
  { id: 'sat-build-handler', label: 'apps/build-service/src/create-build.ts', group: 'builds' },
  { id: 'sat-build-types', label: 'apps/build-service/src/types.ts', group: 'builds' },
  { id: 'sat-build-store', label: 'apps/build-service/src/store.ts', group: 'builds' },
  { id: 'sat-compile-handler', label: 'apps/compile-service/src/compile-source.ts', group: 'builds' },
  { id: 'sat-compile-client', label: 'apps/compile-service/src/registry-client.ts', group: 'builds' },
  { id: 'sat-cache', label: 'apps/compile-service/src/artifact-cache.ts', group: 'builds' },
  { id: 'sat-events', label: 'contracts/events/build-finished.ts', group: 'builds' },
  { id: 'sat-gateway', label: 'apps/edge/src/routes/builds.ts', group: 'edge' },
  { id: 'sat-web', label: 'apps/web/src/publish-form.ts', group: 'edge' },
  { id: 'sat-release', label: 'apps/release-service/src/promote.ts', group: 'release' },
  { id: 'sat-release-state', label: 'apps/release-service/src/state.ts', group: 'release' },
  { id: 'sat-registry', label: 'integrations/package-registry/client.ts', group: 'external' },
]

export const publishStages: PublishStage[] = [
  {
    id: 'core',
    why: 'Client, gateway, build service',
    ops: [
      add('web-client', 'client', 'Web client', 'edge', { latencyMs: 30, capacityRps: 800, failureModes: [] }, 'apps/web'),
      add('api-gateway', 'gateway', 'API gateway', 'edge', {
        latencyMs: 38,
        capacityRps: 1000,
        concurrency: 200,
        failureModes: ['timeout'],
      }, 'apps/edge'),
      add('build-service', 'service', 'Build service', 'builds', {
        latencyMs: 120,
        capacityRps: 300,
        concurrency: 64,
        retry: { attempts: 3, backoffMs: 200 },
        failureModes: ['timeout', 'throttled'],
      }, 'apps/build-service', 'createBuild(input: BuildInput): Build'),
      { op: 'connect', edge: { id: 'e-client-gateway', from: 'web-client', to: 'api-gateway', style: 'sync' } },
      { op: 'connect', edge: { id: 'e-gateway-build', from: 'api-gateway', to: 'build-service', style: 'sync', label: 'POST /builds' } },
      { op: 'focus', id: 'build-service' },
    ],
  },
  {
    id: 'store',
    why: 'Build store added',
    ops: [
      add('build-store', 'store', 'Build store', 'builds', { latencyMs: 9, capacityRps: 1000, failureModes: [] }, 'apps/build-service/src/store.ts'),
      { op: 'connect', edge: { id: 'e-build-store', from: 'build-service', to: 'build-store', style: 'sync' } },
    ],
  },
  {
    id: 'compile',
    why: 'Compile split out',
    ops: [
      add('compile-service', 'service', 'Compile service', 'builds', {
        latencyMs: 140,
        capacityRps: 400,
        concurrency: 64,
        failureModes: ['timeout'],
      }, 'apps/compile-service', 'compile(input: SourceHash): Artifact'),
      { op: 'connect', edge: { id: 'e-build-compile', from: 'build-service', to: 'compile-service', style: 'sync' } },
    ],
  },
  {
    id: 'registry',
    why: 'Package registry, external',
    ops: [
      add('package-registry', 'external', 'Package registry', 'external', {
        latencyMs: 420,
        capacityRps: 200,
        concurrency: 80,
        failureModes: ['timeout', 'throttled'],
      }, 'integrations/package-registry'),
      { op: 'connect', edge: { id: 'e-compile-registry', from: 'compile-service', to: 'package-registry', style: 'sync' } },
    ],
  },
  {
    id: 'domains',
    why: 'Grouped into domains',
    ops: [
      { op: 'update', id: 'web-client', patch: { group: 'edge' } },
      { op: 'update', id: 'api-gateway', patch: { group: 'edge' } },
      { op: 'update', id: 'build-service', patch: { group: 'builds' } },
      { op: 'update', id: 'build-store', patch: { group: 'builds' } },
      { op: 'update', id: 'compile-service', patch: { group: 'builds' } },
      add('release-service', 'service', 'Release service', 'release', {
        latencyMs: 80,
        capacityRps: 120,
        concurrency: 16,
        failureModes: ['timeout'],
      }, 'apps/release-service', 'promote(buildId: BuildId): Release'),
      { op: 'connect', edge: { id: 'e-store-release', from: 'build-store', to: 'release-service', style: 'sync', label: 'poll' } },
      { op: 'focus', id: 'build-service' },
    ],
  },
  {
    id: 'cache',
    why: 'Artifact cache',
    ops: [
      add('artifact-cache', 'cache', 'Artifact cache', 'builds', {
        latencyMs: 2,
        capacityRps: 5000,
        hitRate: 0.62,
        failureModes: [],
      }, 'apps/compile-service/src/artifact-cache.ts', 'get(key: SourceHash): Artifact | miss'),
      { op: 'disconnect', id: 'e-compile-registry' },
      { op: 'connect', edge: { id: 'e-compile-cache', from: 'compile-service', to: 'artifact-cache', style: 'sync' } },
      { op: 'connect', edge: { id: 'e-cache-registry', from: 'artifact-cache', to: 'package-registry', style: 'sync', label: 'miss' } },
    ],
  },
  {
    id: 'events',
    why: 'BuildFinished event + retry',
    ops: [
      { op: 'disconnect', id: 'e-store-release' },
      add('build-events', 'queue', 'Build events', 'builds', { latencyMs: 5, capacityRps: 3000, failureModes: [] }, 'contracts/events/build-finished.ts', 'BuildFinished { buildId, sourceHash }'),
      add('retry-worker', 'function', 'Retry worker', 'builds', {
        latencyMs: 40,
        capacityRps: 80,
        concurrency: 8,
        retry: { attempts: 3, backoffMs: 200 },
        failureModes: ['timeout'],
      }, 'apps/build-service/src/retry-worker.ts', 'backoff(attempt): Duration then dead-letter'),
      add('dead-letter', 'queue', 'Dead letter', 'builds', { latencyMs: 5, capacityRps: 500, failureModes: [] }, 'apps/build-service/src/dead-letter.ts'),
      { op: 'connect', edge: { id: 'e-build-events', from: 'build-service', to: 'build-events', style: 'event', label: 'BuildFinished' } },
      { op: 'connect', edge: { id: 'e-events-release', from: 'build-events', to: 'release-service', style: 'event' } },
      { op: 'connect', edge: { id: 'e-events-retry', from: 'build-events', to: 'retry-worker', style: 'async', label: 'backoff' } },
      { op: 'connect', edge: { id: 'e-retry-dlq', from: 'retry-worker', to: 'dead-letter', style: 'async', label: 'DLQ' } },
    ],
  },
]

export function buildPublishScene(stageCount = publishStages.length, title = 'Publish flow v2'): { scene: Scene; notes: { version: number; why: string }[] } {
  let scene = emptyScene(title)
  const notes: { version: number; why: string }[] = []
  for (const stage of publishStages.slice(0, stageCount)) {
    const applied = applyPatches(scene, stage.ops)
    if (!applied.ok) {
      throw new Error(`Publish stage ${stage.id} failed: ${applied.issues.map((i) => i.message).join('; ')}`)
    }
    scene = applied.scene
    notes.push({ version: scene.version, why: stage.why })
  }
  return { scene, notes }
}

export function opsForCache(scene: Scene): PatchOp[] {
  if (!has(scene, 'compile-service')) return []
  const ops: PatchOp[] = []
  if (!has(scene, 'artifact-cache')) ops.push(publishStages[5]!.ops[0]!)
  if (scene.edges.some((e) => e.id === 'e-compile-registry')) ops.push({ op: 'disconnect', id: 'e-compile-registry' })
  if (!scene.edges.some((e) => e.id === 'e-compile-cache')) {
    ops.push({ op: 'connect', edge: { id: 'e-compile-cache', from: 'compile-service', to: 'artifact-cache', style: 'sync' } })
  }
  if (has(scene, 'package-registry') && !scene.edges.some((e) => e.id === 'e-cache-registry')) {
    ops.push({ op: 'connect', edge: { id: 'e-cache-registry', from: 'artifact-cache', to: 'package-registry', style: 'sync', label: 'miss' } })
  }
  return ops
}

export function opsForEvents(scene: Scene): PatchOp[] {
  const ops: PatchOp[] = []
  if (scene.edges.some((e) => e.id === 'e-store-release')) ops.push({ op: 'disconnect', id: 'e-store-release' })
  if (!has(scene, 'build-events')) ops.push(addOp(publishStages[6]!, 'build-events'))
  if (!scene.edges.some((e) => e.from === 'build-service' && e.to === 'build-events')) {
    ops.push({ op: 'connect', edge: { id: 'e-build-events', from: 'build-service', to: 'build-events', style: 'event', label: 'BuildFinished' } })
  }
  if (has(scene, 'release-service') && !scene.edges.some((e) => e.from === 'build-events' && e.to === 'release-service')) {
    ops.push({ op: 'connect', edge: { id: 'e-events-release', from: 'build-events', to: 'release-service', style: 'event' } })
  }
  return ops
}

export function opsForRetry(scene: Scene): PatchOp[] {
  const ops: PatchOp[] = []
  if (!has(scene, 'retry-worker')) ops.push(addOp(publishStages[6]!, 'retry-worker'))
  if (!has(scene, 'dead-letter')) ops.push(addOp(publishStages[6]!, 'dead-letter'))
  if (!has(scene, 'build-events')) ops.push(...opsForEvents(scene))
  if (!scene.edges.some((e) => e.from === 'build-events' && e.to === 'retry-worker')) {
    ops.push({ op: 'connect', edge: { id: 'e-events-retry', from: 'build-events', to: 'retry-worker', style: 'async', label: 'backoff' } })
  }
  if (!scene.edges.some((e) => e.from === 'retry-worker' && e.to === 'dead-letter')) {
    ops.push({ op: 'connect', edge: { id: 'e-retry-dlq', from: 'retry-worker', to: 'dead-letter', style: 'async', label: 'DLQ' } })
  }
  return ops
}

export function opsForBulkhead(workers: number): PatchOp[] {
  return [{ op: 'update', id: 'compile-service', patch: { behaviour: { concurrency: workers } } }]
}

export function releaseMachinePatch(): PatchOp {
  return { op: 'update', id: 'release-service', patch: { machine: releaseMachine, notes: 'Release state machine. Shape only.' } }
}

function has(scene: Scene, id: string): boolean {
  return scene.components.some((c) => c.id === id)
}

function addOp(stage: PublishStage, id: string): PatchOp {
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
