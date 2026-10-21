import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { Scene } from '../shared/types.ts'
import type { SessionRecord } from '../shared/session.ts'

export function systemPrompt(session: SessionRecord, skillPath = path.join(process.cwd(), 'skills', 'jarvis-scene', 'SKILL.md')): string {
  const skill = existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : ''
  const scene = compact(session.scene)
  return [
    skill,
    '',
    'You are JARVIS in a live voice session. Spoken replies are two to four sentences. No lists, no code, no markdown.',
    'Detail goes into tools, not the ear. Edit the scene with patch_scene. Do not redraw it.',
    'Exactly one component is focused. Set focus to the part you are talking about.',
    'Simulation numbers are illustrative. Say so if you mention them.',
    session.mode === 'grounded'
      ? 'Grounded mode: read_shape only. Describe types and fields, never example values. Do not ask for logs, tickets or customer records.'
      : 'Blank slate: you have scene tools only. Do not invent a repo lookup.',
    '',
    `Session title: ${session.title}`,
    `Context: ${session.mode}`,
    'Current scene JSON:',
    JSON.stringify(scene),
  ].join('\n')
}

function compact(scene: Scene) {
  return {
    version: scene.version,
    title: scene.title,
    focus: scene.focus,
    openQuestions: scene.openQuestions,
    components: scene.components.map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      group: c.group,
      behaviour: c.behaviour,
      notes: c.notes,
      shape: c.shape,
      machine: c.machine,
    })),
    edges: scene.edges,
    decisions: scene.decisions.slice(0, 8),
  }
}
