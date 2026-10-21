import type { Scene } from './types.ts'

const STYLE: Record<string, string> = {
  sync: '-->',
  async: '-.->',
  event: '-.->',
  stream: '==>',
}

export function toMermaid(scene: Scene): string {
  const lines = ['flowchart LR']
  for (const component of scene.components) {
    const shape = component.kind === 'queue' || component.kind === 'store' ? `[${safe(component.label)}]` : `(${safe(component.label)})`
    lines.push(`  ${id(component.id)}${shape}`)
  }
  for (const edge of scene.edges) {
    const arrow = STYLE[edge.style] ?? '-->'
    const label = edge.label ? `|${safe(edge.label)}|` : ''
    lines.push(`  ${id(edge.from)} ${arrow}${label} ${id(edge.to)}`)
  }
  return lines.join('\n')
}

function id(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_')
}

function safe(value: string): string {
  return value.replace(/[[\]()|"]/g, ' ')
}
