import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { publishStages } from '../shared/publish-flow.ts'
import { buildSpec } from '../shared/spec.ts'
import type { PatchOp } from '../shared/types.ts'
import { sceneSvg } from './diagram.ts'
import type { SessionStore } from './store.ts'

export async function ensureSamples(store: SessionStore): Promise<void> {
  const existing = await store.list()
  if (existing.some((session) => !session.sample) || existing.length) return

  await publishV1(store)
  await releasePromotion(store)
  await reviewIntake(store)
}

async function publishV1(store: SessionStore): Promise<void> {
  const session = await store.create({
    title: 'Publish flow v1',
    mode: 'grounded',
    at: '2026-10-12T10:00:00.000Z',
    sample: true,
  })
  for (const stage of publishStages.slice(0, 4)) {
    const applied = await store.applyOps(session, stage.ops, stage.why)
    if (!applied.ok) throw new Error(applied.message)
  }
  session.scene = { ...session.scene, title: 'Publish flow v1' }
  session.spec = buildSpec({
    scene: session.scene,
    folder: path.relative(process.cwd(), session.folder),
    generatedAt: '2026-10-12T11:00:00.000Z',
    startedAt: session.createdAt,
    turns: 6,
    simulations: [],
    evolution: session.versionNotes,
    files: [{ name: 'spec.md', note: 'markdown' }],
  })
  await writeFile(path.join(session.folder, 'spec.md'), session.spec.markdown)
  await writeFile(path.join(session.folder, 'hud-final.svg'), sceneSvg(session.scene))
  await store.save(session)
}

async function releasePromotion(store: SessionStore): Promise<void> {
  const session = await store.create({
    title: 'Release promotion',
    mode: 'blank',
    at: '2026-10-13T10:00:00.000Z',
    sample: true,
  })
  const batches: { why: string; ops: PatchOp[] }[] = [
    {
      why: 'Rollout client and gateway',
      ops: [
        { op: 'add', component: { id: 'rollout-client', kind: 'client', label: 'Rollout client', group: 'edge', behaviour: { latencyMs: 30, capacityRps: 200, failureModes: [] } } },
        { op: 'add', component: { id: 'rollout-gateway', kind: 'gateway', label: 'Rollout gateway', group: 'edge', behaviour: { latencyMs: 20, capacityRps: 400, concurrency: 40, failureModes: ['timeout'] } } },
        { op: 'connect', edge: { from: 'rollout-client', to: 'rollout-gateway', style: 'sync' } },
      ],
    },
    {
      why: 'Release service',
      ops: [
        { op: 'add', component: { id: 'release-service', kind: 'service', label: 'Release service', group: 'release', behaviour: { latencyMs: 70, capacityRps: 120, concurrency: 16, failureModes: ['timeout'] }, notes: 'Owns the release lifecycle.' } },
        { op: 'connect', edge: { from: 'rollout-gateway', to: 'release-service', style: 'sync', label: 'POST /promotions' } },
      ],
    },
    {
      why: 'Notify',
      ops: [
        { op: 'add', component: { id: 'notify-service', kind: 'service', label: 'Notify service', group: 'release', behaviour: { latencyMs: 90, capacityRps: 80, concurrency: 12, failureModes: ['timeout'] } } },
        { op: 'connect', edge: { from: 'release-service', to: 'notify-service', style: 'sync' } },
      ],
    },
    {
      why: 'Notice queue',
      ops: [
        { op: 'add', component: { id: 'notice-queue', kind: 'queue', label: 'Notice queue', group: 'release', behaviour: { latencyMs: 6, capacityRps: 1000, failureModes: [] } } },
        { op: 'connect', edge: { from: 'release-service', to: 'notice-queue', style: 'event', label: 'PromotionDue' } },
      ],
    },
    {
      why: 'State machine',
      ops: [
        {
          op: 'update',
          id: 'release-service',
          patch: {
            machine: {
              initial: 'staged',
              states: [
                { id: 'staged', label: 'Staged' },
                { id: 'due', label: 'Due' },
                { id: 'promoted', label: 'Promoted' },
                { id: 'rolled-back', label: 'Rolled back' },
              ],
              transitions: [
                { from: 'staged', to: 'due', on: 'Window opening' },
                { from: 'due', to: 'promoted', on: 'Promote' },
                { from: 'due', to: 'rolled-back', on: 'Window ends' },
              ],
            },
          },
        },
        { op: 'focus', id: 'release-service' },
      ],
    },
  ]
  for (const batch of batches) await store.applyOps(session, batch.ops, batch.why)
  await store.decide(session, {
    chose: 'Promotion is a state machine, not a new release',
    because: 'Rollback and republish need a named transition',
    affects: ['release-service'],
    rejected: ['Create a fresh release on every channel'],
  })
  await store.save(session)
}

async function reviewIntake(store: SessionStore): Promise<void> {
  const session = await store.create({
    title: 'Dependency review intake',
    mode: 'blank',
    at: '2026-10-14T10:00:00.000Z',
    sample: true,
  })
  const batches: { why: string; ops: PatchOp[] }[] = [
    {
      why: 'Review console and gateway',
      ops: [
        { op: 'add', component: { id: 'review-console', kind: 'client', label: 'Review console', group: 'edge', behaviour: { latencyMs: 40, capacityRps: 100, failureModes: [] } } },
        { op: 'add', component: { id: 'review-gateway', kind: 'gateway', label: 'Review gateway', group: 'edge', behaviour: { latencyMs: 22, capacityRps: 300, concurrency: 40, failureModes: ['timeout'] } } },
        { op: 'connect', edge: { from: 'review-console', to: 'review-gateway', style: 'sync', label: 'POST /reviews' } },
      ],
    },
    {
      why: 'Review service',
      ops: [
        { op: 'add', component: { id: 'review-service', kind: 'service', label: 'Review service', group: 'reviews', behaviour: { latencyMs: 110, capacityRps: 80, concurrency: 24, failureModes: ['timeout'] }, notes: 'Opens a review from a dependency scan.' } },
        { op: 'connect', edge: { from: 'review-gateway', to: 'review-service', style: 'sync' } },
        { op: 'focus', id: 'review-service' },
      ],
    },
    {
      why: 'Reports and advisory queue',
      ops: [
        { op: 'add', component: { id: 'report-store', kind: 'store', label: 'Report store', group: 'reviews', behaviour: { latencyMs: 15, capacityRps: 200, failureModes: [] } } },
        { op: 'add', component: { id: 'advisory-queue', kind: 'queue', label: 'Advisory queue', group: 'reviews', behaviour: { latencyMs: 8, capacityRps: 500, failureModes: [] } } },
        { op: 'connect', edge: { from: 'review-service', to: 'report-store', style: 'sync' } },
        { op: 'connect', edge: { from: 'review-service', to: 'advisory-queue', style: 'async', label: 'AdvisoryFlagged' } },
      ],
    },
  ]
  for (const batch of batches) await store.applyOps(session, batch.ops, batch.why)
  await store.decide(session, {
    chose: 'Advisory review is async',
    because: 'Intake should not wait on a manual screen',
    affects: ['advisory-queue', 'review-service'],
    rejected: ['Synchronous advisory check on submit'],
  })
  await store.save(session)
}
