import type { Decision, Scene, SimResult } from './types.ts'
import { toMermaid } from './mermaid.ts'
import { formatMs } from './format.ts'

export type SpecFile = { name: string; note: string }

export type SpecDocument = {
  title: string
  generatedAt: string
  minutes: number
  turns: number
  folder: string
  files: SpecFile[]
  summary: string
  mermaid: string
  components: { id: string; responsibility: string; p50: string; capacity: string }[]
  flows: { title: string; detail: string }[]
  decisions: { at: string; chose: string; because: string; rejected?: string[]; affects: string[] }[]
  questions: string[]
  evolution: { version: number; why: string }[]
  markdown: string
}

export function buildSpec(input: {
  scene: Scene
  folder: string
  generatedAt: string
  startedAt: string
  turns: number
  simulations: SimResult[]
  evolution: { version: number; why: string }[]
  files: SpecFile[]
}): SpecDocument {
  const summary = summarise(input.scene)
  const components = input.scene.components.map((component) => ({
    id: component.id,
    responsibility: component.notes?.split('\n')[0] || responsibility(component.kind, component.label),
    p50: formatMs(component.behaviour.latencyMs),
    capacity: `${Math.round(component.behaviour.capacityRps)} rps`,
  }))
  const flows = input.simulations.slice(-4).map((sim) => ({
    title: sim.scenario.prompt || `${sim.mode} from ${sim.entry}`,
    detail: `${sim.mode} · ${formatMs(sim.summary.e2eP50Ms)} end to end · bottleneck ${sim.summary.bottleneck} · illustrative`,
  }))
  const decisions = input.scene.decisions.map(presentDecision)
  const evolution = pickEvolution(input.evolution, input.scene.version)
  const doc: SpecDocument = {
    title: input.scene.title,
    generatedAt: input.generatedAt,
    minutes: Math.max(1, Math.round((Date.parse(input.generatedAt) - Date.parse(input.startedAt)) / 60000)),
    turns: input.turns,
    folder: input.folder,
    files: input.files,
    summary,
    mermaid: toMermaid(input.scene),
    components,
    flows,
    decisions,
    questions: [...input.scene.openQuestions],
    evolution,
    markdown: '',
  }
  doc.markdown = renderMarkdown(doc)
  return doc
}

export function pickEvolution(
  notes: { version: number; why: string }[],
  current: number,
): { version: number; why: string }[] {
  const unique = new Map<number, string>()
  for (const note of notes) unique.set(note.version, note.why)
  if (!unique.has(1) && current >= 1) unique.set(1, 'First sketch')
  if (current > 0) unique.set(current, unique.get(current) ?? 'Current scene')
  const all = [...unique.entries()].sort((a, b) => a[0] - b[0])
  if (all.length <= 5) return all.map(([version, why]) => ({ version, why }))
  const first = all[0]!
  const last = all[all.length - 1]!
  const middle = all.slice(1, -1)
  const step = Math.max(1, Math.floor(middle.length / 3))
  const picked = [first, middle[0], middle[Math.min(middle.length - 1, step)], middle[middle.length - 1], last]
    .filter((item): item is [number, string] => Boolean(item))
  const seen = new Set<number>()
  return picked
    .filter(([version]) => (seen.has(version) ? false : (seen.add(version), true)))
    .map(([version, why]) => ({ version, why }))
}

function renderMarkdown(doc: SpecDocument): string {
  const lines: string[] = [
    `# ${doc.title}`,
    '',
    `Generated ${doc.generatedAt}. Illustrative numbers, not a capacity plan. Only the scene model is written here.`,
    '',
    '## 1. Summary',
    '',
    doc.summary,
    '',
    '## 2. Architecture',
    '',
    '![HUD](hud-final.svg)',
    '',
    '```mermaid',
    doc.mermaid,
    '```',
    '',
    '## 3. Components',
    '',
    '| Component | Responsibility | p50 | Capacity |',
    '| --- | --- | --- | --- |',
    ...doc.components.map((c) => `| ${c.id} | ${c.responsibility.replace(/\|/g, '/')} | ${c.p50} | ${c.capacity} |`),
    '',
    '## 4. Flows',
    '',
  ]
  if (!doc.flows.length) lines.push('No simulations were run.')
  for (const flow of doc.flows) {
    lines.push(`- **${flow.title}.** ${flow.detail}`)
  }
  lines.push('', '## 5. Decisions', '', '| When | Chose | Because | Rejected | Affects |', '| --- | --- | --- | --- | --- |')
  const newest = [...doc.decisions]
  if (!newest.length) lines.push('| — | — | — | — | — |')
  for (const decision of newest) {
    lines.push(
      `| ${decision.at} | ${escapeCell(decision.chose)} | ${escapeCell(decision.because)} | ${escapeCell(decision.rejected?.join('; ') || '—')} | ${decision.affects.join(', ') || '—'} |`,
    )
  }
  lines.push('', '## 6. Open questions', '')
  if (!doc.questions.length) lines.push('None.')
  for (const question of doc.questions) lines.push(`- ${question}`)
  lines.push('', '## 7. Evolution', '')
  for (const snap of doc.evolution) {
    lines.push(`- **v${String(snap.version).padStart(2, '0')}.** ${snap.why}`)
  }
  lines.push('')
  return lines.join('\n')
}

function summarise(scene: Scene): string {
  const services = scene.components.filter((c) => c.kind === 'service').map((c) => c.label.toLowerCase())
  const events = scene.edges.filter((e) => e.style === 'event')
  const caches = scene.components.filter((c) => c.kind === 'cache')
  const first = services.length
    ? `${scene.title} is built from ${services.slice(0, 3).join(', ')}.`
    : `${scene.title} does not have services yet.`
  const second = caches.length
    ? `A ${caches[0]!.label.toLowerCase()} sits in front of the slow dependency so repeat work can skip it.`
    : 'There is no cache in the scene yet.'
  const third = events.length
    ? `Async work leaves through ${events.map((e) => e.label || e.style).join(', ')}.`
    : 'The edges drawn so far are synchronous.'
  return `${first} ${second} ${third}`
}

function responsibility(kind: string, label: string): string {
  return `${label}. ${kind}.`
}

function presentDecision(decision: Decision): SpecDocument['decisions'][number] {
  return {
    at: decision.at,
    chose: decision.chose,
    because: decision.because,
    rejected: decision.rejected,
    affects: decision.affects,
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '/').replace(/\n/g, ' ')
}
