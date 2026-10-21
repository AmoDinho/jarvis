import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { buildQuoteScene } from '../shared/quote-flow.ts'
import { buildSpec } from '../shared/spec.ts'
import type { PatchOp } from '../shared/types.ts'
import { sceneSvg } from './diagram.ts'
import type { SessionStore } from './store.ts'

export async function ensureSamples(store: SessionStore): Promise<void> {
  const existing = await store.list()
  if (existing.some((session) => !session.sample) || existing.length) return

  await quoteV1(store)
  await policyRenewal(store)
  await claimsFnol(store)
}

async function quoteV1(store: SessionStore): Promise<void> {
  const session = await store.create({
    title: 'Quote flow v1',
    mode: 'grounded',
    at: '2026-10-12T10:00:00.000Z',
    sample: true,
  })
  const built = buildQuoteScene(4, 'Quote flow v1')
  session.scene = built.scene
  session.versionNotes = built.notes
  session.spec = buildSpec({
    scene: session.scene,
    folder: path.relative(process.cwd(), session.folder),
    generatedAt: '2026-10-12T11:00:00.000Z',
    startedAt: session.createdAt,
    turns: 6,
    simulations: [],
    evolution: built.notes,
    files: [{ name: 'spec.md', note: 'markdown' }],
  })
  await writeFile(path.join(session.folder, 'spec.md'), session.spec.markdown)
  await writeFile(path.join(session.folder, 'hud-final.svg'), sceneSvg(session.scene))
  await store.save(session)
}

async function policyRenewal(store: SessionStore): Promise<void> {
  const session = await store.create({
    title: 'Policy renewal',
    mode: 'blank',
    at: '2026-10-13T10:00:00.000Z',
    sample: true,
  })
  const batches: { why: string; ops: PatchOp[] }[] = [
    {
      why: 'Renewal client and gateway',
      ops: [
        { op: 'add', component: { id: 'renewal-client', kind: 'client', label: 'Renewal client', group: 'edge', behaviour: { latencyMs: 30, capacityRps: 200, failureModes: [] } } },
        { op: 'add', component: { id: 'renewal-gateway', kind: 'gateway', label: 'Renewal gateway', group: 'edge', behaviour: { latencyMs: 20, capacityRps: 400, concurrency: 40, failureModes: ['timeout'] } } },
        { op: 'connect', edge: { from: 'renewal-client', to: 'renewal-gateway', style: 'sync' } },
      ],
    },
    {
      why: 'Policy service',
      ops: [
        { op: 'add', component: { id: 'policy-service', kind: 'service', label: 'Policy service', group: 'policy', behaviour: { latencyMs: 70, capacityRps: 120, concurrency: 16, failureModes: ['timeout'] }, notes: 'Owns the policy lifecycle.' } },
        { op: 'connect', edge: { from: 'renewal-gateway', to: 'policy-service', style: 'sync', label: 'POST /renewals' } },
      ],
    },
    {
      why: 'Billing',
      ops: [
        { op: 'add', component: { id: 'billing-service', kind: 'service', label: 'Billing service', group: 'policy', behaviour: { latencyMs: 90, capacityRps: 80, concurrency: 12, failureModes: ['timeout'] } } },
        { op: 'connect', edge: { from: 'policy-service', to: 'billing-service', style: 'sync' } },
      ],
    },
    {
      why: 'Notice queue',
      ops: [
        { op: 'add', component: { id: 'notice-queue', kind: 'queue', label: 'Notice queue', group: 'policy', behaviour: { latencyMs: 6, capacityRps: 1000, failureModes: [] } } },
        { op: 'connect', edge: { from: 'policy-service', to: 'notice-queue', style: 'event', label: 'RenewalDue' } },
      ],
    },
    {
      why: 'State machine',
      ops: [
        {
          op: 'update',
          id: 'policy-service',
          patch: {
            machine: {
              initial: 'active',
              states: [
                { id: 'active', label: 'Active' },
                { id: 'due', label: 'Due' },
                { id: 'renewed', label: 'Renewed' },
                { id: 'lapsed', label: 'Lapsed' },
              ],
              transitions: [
                { from: 'active', to: 'due', on: 'Term ending' },
                { from: 'due', to: 'renewed', on: 'Bind renewal' },
                { from: 'due', to: 'lapsed', on: 'Grace ends' },
              ],
            },
          },
        },
        { op: 'focus', id: 'policy-service' },
      ],
    },
  ]
  for (const batch of batches) await store.applyOps(session, batch.ops, batch.why)
  await store.decide(session, {
    chose: 'Renewal is a state machine, not a new policy',
    because: 'Lapse and reinstatement need a named transition',
    affects: ['policy-service'],
    rejected: ['Create a fresh policy on every term'],
  })
  await store.save(session)
}

async function claimsFnol(store: SessionStore): Promise<void> {
  const session = await store.create({
    title: 'Claims FNOL intake',
    mode: 'blank',
    at: '2026-10-14T10:00:00.000Z',
    sample: true,
  })
  const batches: { why: string; ops: PatchOp[] }[] = [
    {
      why: 'Intake form and gateway',
      ops: [
        { op: 'add', component: { id: 'fnol-form', kind: 'client', label: 'FNOL form', group: 'edge', behaviour: { latencyMs: 40, capacityRps: 100, failureModes: [] } } },
        { op: 'add', component: { id: 'claims-gateway', kind: 'gateway', label: 'Claims gateway', group: 'edge', behaviour: { latencyMs: 22, capacityRps: 300, concurrency: 40, failureModes: ['timeout'] } } },
        { op: 'connect', edge: { from: 'fnol-form', to: 'claims-gateway', style: 'sync', label: 'POST /fnol' } },
      ],
    },
    {
      why: 'Claims service',
      ops: [
        { op: 'add', component: { id: 'claims-service', kind: 'service', label: 'Claims service', group: 'claims', behaviour: { latencyMs: 110, capacityRps: 80, concurrency: 24, failureModes: ['timeout'] }, notes: 'Opens a claim from first notice.' } },
        { op: 'connect', edge: { from: 'claims-gateway', to: 'claims-service', style: 'sync' } },
        { op: 'focus', id: 'claims-service' },
      ],
    },
    {
      why: 'Documents and fraud queue',
      ops: [
        { op: 'add', component: { id: 'document-store', kind: 'store', label: 'Document store', group: 'claims', behaviour: { latencyMs: 15, capacityRps: 200, failureModes: [] } } },
        { op: 'add', component: { id: 'fraud-queue', kind: 'queue', label: 'Fraud queue', group: 'claims', behaviour: { latencyMs: 8, capacityRps: 500, failureModes: [] } } },
        { op: 'connect', edge: { from: 'claims-service', to: 'document-store', style: 'sync' } },
        { op: 'connect', edge: { from: 'claims-service', to: 'fraud-queue', style: 'async', label: 'FraudFlagged' } },
      ],
    },
  ]
  for (const batch of batches) await store.applyOps(session, batch.ops, batch.why)
  await store.decide(session, {
    chose: 'Fraud review is async',
    because: 'Intake should not wait on a manual screen',
    affects: ['fraud-queue', 'claims-service'],
    rejected: ['Synchronous fraud check on submit'],
  })
  await store.save(session)
}
