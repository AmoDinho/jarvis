import {
  COMPONENT_KINDS,
  EDGE_STYLES,
  type Behaviour,
  type Component,
  type ComponentKind,
  type ComponentPatch,
  type Decision,
  type Edge,
  type PatchOp,
  type Scene,
  cloneScene,
} from './types.ts'
import { slugify } from './format.ts'

export type PatchIssue = { index: number; message: string }

export type AppliedOp = {
  op: PatchOp['op']
  target: string
  detail: string
}

const ID_RE = /^[a-z][a-z0-9-]{0,48}$/

export function behaviourFor(kind: ComponentKind): Behaviour {
  switch (kind) {
    case 'client':
      return { latencyMs: 40, capacityRps: 400, failureModes: [] }
    case 'gateway':
      return { latencyMs: 25, capacityRps: 800, concurrency: 200, failureModes: ['timeout'] }
    case 'service':
      return { latencyMs: 80, capacityRps: 200, concurrency: 32, failureModes: ['timeout'] }
    case 'queue':
      return { latencyMs: 6, capacityRps: 2000, failureModes: [] }
    case 'store':
      return { latencyMs: 8, capacityRps: 800, failureModes: [] }
    case 'cache':
      return { latencyMs: 2, capacityRps: 5000, hitRate: 0.7, failureModes: [] }
    case 'external':
      return { latencyMs: 280, capacityRps: 60, failureModes: ['timeout', 'throttled'] }
    case 'function':
      return {
        latencyMs: 35,
        capacityRps: 150,
        retry: { attempts: 3, backoffMs: 200 },
        failureModes: ['timeout'],
      }
  }
}

export function applyPatches(
  scene: Scene,
  ops: PatchOp[],
): { ok: true; scene: Scene; applied: AppliedOp[] } | { ok: false; scene: Scene; issues: PatchIssue[] } {
  if (ops.length === 0) {
    return { ok: false, scene, issues: [{ index: -1, message: 'No operations.' }] }
  }
  const draft = cloneScene(scene)
  const applied: AppliedOp[] = []
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]
    if (!op) continue
    const result = applyOne(draft, op)
    if (!result.ok) return { ok: false, scene, issues: [{ index, message: result.message }] }
    applied.push(result.applied)
  }
  if (draft.focus && !draft.components.some((c) => c.id === draft.focus)) {
    return { ok: false, scene, issues: [{ index: -1, message: 'Focus does not match a component.' }] }
  }
  draft.version += 1
  return { ok: true, scene: draft, applied }
}

export function logDecision(
  scene: Scene,
  input: { chose: string; rejected?: string[]; because: string; affects: string[]; at?: string },
): { ok: true; scene: Scene; decision: Decision } | { ok: false; message: string } {
  const chose = input.chose.trim()
  const because = input.because.trim()
  if (!chose || !because) return { ok: false, message: 'A decision needs chose and because.' }
  if (chose.length > 180 || because.length > 280) return { ok: false, message: 'Decision text is too long.' }
  const unknown = input.affects.filter((id) => !scene.components.some((c) => c.id === id))
  if (unknown.length) return { ok: false, message: `Decision affects unknown components: ${unknown.join(', ')}.` }
  const n = scene.decisions.length + 1
  const decision: Decision = {
    id: `d-${String(n).padStart(3, '0')}`,
    at: input.at ?? new Date().toISOString(),
    chose,
    because,
    affects: [...input.affects],
    rejected: input.rejected?.map((r) => r.trim()).filter(Boolean).slice(0, 6),
  }
  return { ok: true, scene: { ...cloneScene(scene), decisions: [decision, ...scene.decisions] }, decision }
}

export function touchVersion(scene: Scene): Scene {
  return { ...cloneScene(scene), version: scene.version + 1 }
}

function applyOne(draft: Scene, op: PatchOp): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  switch (op.op) {
    case 'add':
      return addComponent(draft, op.component)
    case 'update':
      return updateComponent(draft, op.id, op.patch)
    case 'remove':
      return removeComponent(draft, op.id)
    case 'connect':
      return connect(draft, op.edge)
    case 'disconnect':
      return disconnect(draft, op)
    case 'focus':
      return setFocus(draft, op.id)
    case 'retitle':
      return retitle(draft, op.title)
    case 'question':
      return addQuestion(draft, op.text)
    case 'resolve_question':
      return resolveQuestion(draft, op.text)
    case 'satellites':
      return setSatellites(draft, op.satellites)
    case 'tidy':
      return tidy(draft)
    default:
      return { ok: false, message: 'Unknown operation.' }
  }
}

function addComponent(
  draft: Scene,
  input: Partial<Component> & Pick<Component, 'id' | 'kind' | 'label'>,
): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  const id = normaliseId(input.id)
  if (!id) return { ok: false, message: 'Component id is empty.' }
  if (!COMPONENT_KINDS.includes(input.kind)) return { ok: false, message: `Unknown kind ${input.kind}.` }
  if (draft.components.some((c) => c.id === id)) return { ok: false, message: `Component ${id} already exists.` }
  const label = input.label.trim()
  if (!label || label.length > 60) return { ok: false, message: 'Label must be 1–60 characters.' }
  const behaviour = mergeBehaviour(behaviourFor(input.kind), input.behaviour)
  const behaviourIssue = validateBehaviour(behaviour)
  if (behaviourIssue) return { ok: false, message: behaviourIssue }
  const component: Component = {
    id,
    kind: input.kind,
    label,
    behaviour,
  }
  if (input.group?.trim()) component.group = input.group.trim().slice(0, 32)
  if (input.position) {
    const pos = validatePosition(input.position)
    if (!pos.ok) return pos
    component.position = pos.position
  }
  if (input.notes?.trim()) component.notes = input.notes.trim().slice(0, 500)
  if (input.shape) component.shape = cleanShape(input.shape)
  if (input.machine) {
    const machine = validateMachine(input.machine)
    if (!machine.ok) return machine
    component.machine = machine.machine
  }
  draft.components.push(component)
  if (!draft.focus) draft.focus = id
  return {
    ok: true,
    applied: { op: 'add', target: id, detail: `${input.kind} · ${label}` },
  }
}

function updateComponent(
  draft: Scene,
  id: string,
  patch: ComponentPatch,
): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  const component = draft.components.find((c) => c.id === id)
  if (!component) return { ok: false, message: `No component ${id}.` }
  const before = structuredClone(component.behaviour)
  if (patch.label !== undefined) {
    const label = patch.label.trim()
    if (!label || label.length > 60) return { ok: false, message: 'Label must be 1–60 characters.' }
    component.label = label
  }
  if (patch.kind !== undefined) {
    if (!COMPONENT_KINDS.includes(patch.kind)) return { ok: false, message: `Unknown kind ${patch.kind}.` }
    component.kind = patch.kind
  }
  if (patch.group === null) delete component.group
  else if (patch.group !== undefined) component.group = patch.group.trim().slice(0, 32)
  if (patch.position === null) delete component.position
  else if (patch.position) {
    const pos = validatePosition(patch.position)
    if (!pos.ok) return pos
    component.position = pos.position
  }
  if (patch.notes === null) delete component.notes
  else if (patch.notes !== undefined) component.notes = patch.notes.trim().slice(0, 500)
  if (patch.shape === null) delete component.shape
  else if (patch.shape) component.shape = cleanShape({ ...component.shape, ...patch.shape })
  if (patch.machine === null) delete component.machine
  else if (patch.machine) {
    const machine = validateMachine(patch.machine)
    if (!machine.ok) return machine
    component.machine = machine.machine
  }
  if (patch.behaviour) {
    component.behaviour = mergeBehaviour(component.behaviour, patch.behaviour)
    const issue = validateBehaviour(component.behaviour)
    if (issue) return { ok: false, message: issue }
  }
  return { ok: true, applied: { op: 'update', target: id, detail: describeBehaviourChange(before, component.behaviour, patch) } }
}

function removeComponent(draft: Scene, id: string): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  const index = draft.components.findIndex((c) => c.id === id)
  if (index < 0) return { ok: false, message: `No component ${id}.` }
  draft.components.splice(index, 1)
  draft.edges = draft.edges.filter((e) => e.from !== id && e.to !== id)
  if (draft.focus === id) {
    draft.focus = draft.components[0]?.id
    if (!draft.focus) delete draft.focus
  }
  return { ok: true, applied: { op: 'remove', target: id, detail: 'removed with its edges' } }
}

function connect(
  draft: Scene,
  edge: Partial<Edge> & Pick<Edge, 'from' | 'to' | 'style'>,
): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  const from = normaliseId(edge.from)
  const to = normaliseId(edge.to)
  if (!from || !to) return { ok: false, message: 'Edge needs from and to.' }
  if (from === to) return { ok: false, message: 'An edge cannot loop to itself.' }
  if (!draft.components.some((c) => c.id === from)) return { ok: false, message: `No component ${from}.` }
  if (!draft.components.some((c) => c.id === to)) return { ok: false, message: `No component ${to}.` }
  if (!EDGE_STYLES.includes(edge.style)) return { ok: false, message: `Unknown edge style ${edge.style}.` }
  const existing = draft.edges.find((e) => e.from === from && e.to === to && e.style === edge.style)
  const label = edge.label?.trim().slice(0, 60)
  if (existing) {
    if (label) existing.label = label
    return { ok: true, applied: { op: 'connect', target: existing.id, detail: `${from} → ${to} · ${edge.style}` } }
  }
  const id = edge.id ? normaliseId(edge.id) : `${from}--${to}`
  if (!id) return { ok: false, message: 'Edge id is empty.' }
  if (draft.edges.some((e) => e.id === id)) return { ok: false, message: `Edge ${id} already exists.` }
  draft.edges.push({ id, from, to, style: edge.style, label })
  return { ok: true, applied: { op: 'connect', target: id, detail: `${edge.style}${label ? ` · ${label}` : ''} · ${from} → ${to}` } }
}

function disconnect(
  draft: Scene,
  op: { id?: string; from?: string; to?: string },
): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  const before = draft.edges.length
  if (op.id) {
    draft.edges = draft.edges.filter((e) => e.id !== op.id)
  } else if (op.from && op.to) {
    const from = normaliseId(op.from)
    const to = normaliseId(op.to)
    draft.edges = draft.edges.filter((e) => !(e.from === from && e.to === to))
  } else {
    return { ok: false, message: 'Disconnect needs an id or from and to.' }
  }
  if (draft.edges.length === before) return { ok: false, message: 'No matching edge.' }
  return { ok: true, applied: { op: 'disconnect', target: op.id ?? `${op.from} → ${op.to}`, detail: 'disconnected' } }
}

function setFocus(draft: Scene, id: string | null): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  if (id === null) {
    delete draft.focus
    return { ok: true, applied: { op: 'focus', target: '—', detail: 'focus cleared' } }
  }
  const normalised = normaliseId(id)
  if (!draft.components.some((c) => c.id === normalised)) return { ok: false, message: `No component ${id}.` }
  draft.focus = normalised
  return { ok: true, applied: { op: 'focus', target: normalised, detail: 'lit' } }
}

function retitle(draft: Scene, title: string): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  const next = title.trim()
  if (!next || next.length > 80) return { ok: false, message: 'Title must be 1–80 characters.' }
  draft.title = next
  return { ok: true, applied: { op: 'retitle', target: next, detail: 'title updated' } }
}

function addQuestion(draft: Scene, text: string): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  const q = text.trim()
  if (!q || q.length > 200) return { ok: false, message: 'Question must be 1–200 characters.' }
  if (draft.openQuestions.some((existing) => existing.toLowerCase() === q.toLowerCase())) {
    return { ok: true, applied: { op: 'question', target: q, detail: 'already open' } }
  }
  if (draft.openQuestions.length >= 12) return { ok: false, message: 'Too many open questions.' }
  draft.openQuestions.push(q)
  return { ok: true, applied: { op: 'question', target: q, detail: 'left open' } }
}

function resolveQuestion(draft: Scene, text: string): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  const q = text.trim().toLowerCase()
  const index = draft.openQuestions.findIndex((existing) => existing.toLowerCase() === q)
  if (index < 0) return { ok: false, message: 'No matching open question.' }
  const [removed] = draft.openQuestions.splice(index, 1)
  return { ok: true, applied: { op: 'resolve_question', target: removed ?? text, detail: 'resolved' } }
}

function setSatellites(
  draft: Scene,
  satellites: Scene['satellites'],
): { ok: true; applied: AppliedOp } | { ok: false; message: string } {
  if (!satellites) return { ok: false, message: 'Satellites missing.' }
  if (satellites.length > 80) return { ok: false, message: 'Too many satellites.' }
  const clean = []
  for (const sat of satellites) {
    const id = normaliseId(sat.id)
    if (!id) return { ok: false, message: 'Satellite id is empty.' }
    const label = sat.label.trim().slice(0, 80)
    if (!label) return { ok: false, message: 'Satellite label is empty.' }
    clean.push({ id, label, group: sat.group.trim().slice(0, 32) || 'external' })
  }
  draft.satellites = clean
  return { ok: true, applied: { op: 'satellites', target: `${clean.length}`, detail: 'shape stars updated' } }
}

function tidy(draft: Scene): { ok: true; applied: AppliedOp } {
  const groups = new Map<string, Component[]>()
  for (const component of draft.components) {
    const key = component.group || component.kind
    const list = groups.get(key) ?? []
    list.push(component)
    groups.set(key, list)
  }
  let row = 0
  for (const list of groups.values()) {
    list.forEach((component, column) => {
      component.position = [column, row]
    })
    row += 1
  }
  return { ok: true, applied: { op: 'tidy', target: 'scene', detail: `re-laid ${draft.components.length} components` } }
}

function mergeBehaviour(base: Behaviour, patch?: Partial<Behaviour>): Behaviour {
  if (!patch) return { ...base, failureModes: [...base.failureModes] }
  const next: Behaviour = {
    ...base,
    ...patch,
    failureModes: patch.failureModes ? [...patch.failureModes] : [...base.failureModes],
  }
  if (patch.retry) next.retry = { ...patch.retry }
  else if (base.retry) next.retry = { ...base.retry }
  return next
}

function validateBehaviour(behaviour: Behaviour): string | null {
  if (!Number.isFinite(behaviour.latencyMs) || behaviour.latencyMs < 0 || behaviour.latencyMs > 600_000) {
    return 'latencyMs is out of range.'
  }
  if (!Number.isFinite(behaviour.capacityRps) || behaviour.capacityRps <= 0 || behaviour.capacityRps > 1_000_000) {
    return 'capacityRps is out of range.'
  }
  if (behaviour.concurrency !== undefined) {
    if (!Number.isInteger(behaviour.concurrency) || behaviour.concurrency < 1 || behaviour.concurrency > 10_000) {
      return 'concurrency must be a positive integer.'
    }
  }
  if (behaviour.retry) {
    const { attempts, backoffMs } = behaviour.retry
    if (!Number.isInteger(attempts) || attempts < 0 || attempts > 10) return 'retry attempts must be 0–10.'
    if (!Number.isFinite(backoffMs) || backoffMs < 0 || backoffMs > 60_000) return 'backoffMs is out of range.'
  }
  if (behaviour.hitRate !== undefined) {
    if (behaviour.hitRate < 0 || behaviour.hitRate > 1) return 'hitRate must be between 0 and 1.'
  }
  if (behaviour.failureModes.length > 8) return 'Too many failure modes.'
  if (behaviour.failureModes.some((mode) => mode.length > 40)) return 'Failure mode name is too long.'
  return null
}

function validatePosition(position: [number, number]): { ok: true; position: [number, number] } | { ok: false; message: string } {
  const [x, y] = position
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 40 || y > 40) {
    return { ok: false, message: 'Position must be a grid cell.' }
  }
  return { ok: true, position: [x, y] }
}

function validateMachine(
  machine: NonNullable<Component['machine']>,
): { ok: true; machine: NonNullable<Component['machine']> } | { ok: false; message: string } {
  if (!machine.states.length || machine.states.length > 16) return { ok: false, message: 'Machine needs 1–16 states.' }
  const ids = new Set(machine.states.map((s) => s.id))
  if (!ids.has(machine.initial)) return { ok: false, message: 'Machine initial state is missing.' }
  for (const transition of machine.transitions) {
    if (!ids.has(transition.from) || !ids.has(transition.to)) return { ok: false, message: 'Transition references an unknown state.' }
    if (!transition.on.trim()) return { ok: false, message: 'Transition needs a name.' }
  }
  return { ok: true, machine }
}

function cleanShape(shape: NonNullable<Component['shape']>): NonNullable<Component['shape']> {
  return {
    path: shape.path?.trim().slice(0, 120),
    signature: shape.signature?.trim().slice(0, 180),
    fields: shape.fields?.map((f) => f.trim()).filter(Boolean).slice(0, 16),
  }
}

function describeBehaviourChange(before: Behaviour, after: Behaviour, patch: ComponentPatch): string {
  if (!patch.behaviour) {
    if (patch.machine) return 'state machine updated'
    if (patch.notes) return 'notes updated'
    if (patch.group) return `group → ${patch.group}`
    return 'updated'
  }
  const parts: string[] = []
  if (before.concurrency !== after.concurrency && after.concurrency !== undefined) {
    parts.push(`behaviour.concurrency ${before.concurrency ?? '—'} → ${after.concurrency}`)
  }
  if (before.latencyMs !== after.latencyMs) parts.push(`latency ${before.latencyMs} → ${after.latencyMs} ms`)
  if (before.capacityRps !== after.capacityRps) parts.push(`capacity ${before.capacityRps} → ${after.capacityRps} rps`)
  if (JSON.stringify(before.retry) !== JSON.stringify(after.retry) && after.retry) {
    parts.push(`retry ${after.retry.attempts} × ${after.retry.backoffMs} ms`)
  }
  if (JSON.stringify(before.failureModes) !== JSON.stringify(after.failureModes)) {
    parts.push(`failure modes ${after.failureModes.join(', ') || 'none'}`)
  }
  return parts.join(' · ') || 'behaviour updated'
}

export function normaliseId(id: string): string {
  const slug = slugify(id)
  return ID_RE.test(slug) ? slug : ''
}

export function findComponent(scene: Scene, hint: string): Component | undefined {
  const needle = hint.toLowerCase().trim()
  const slug = slugify(hint)
  const exact = scene.components.find((c) => c.id === slug || c.label.toLowerCase() === needle)
  if (exact) return exact
  const partial = scene.components.filter(
    (c) => c.id.includes(slug) || c.label.toLowerCase().includes(needle) || needle.includes(c.label.toLowerCase()),
  )
  return partial.length === 1 ? partial[0] : partial.find((c) => c.id === slug)
}
