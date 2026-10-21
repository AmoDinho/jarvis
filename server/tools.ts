import type { SessionRecord } from '../shared/session.ts'

export function toolDefinitions(mode: SessionRecord['mode']) {
  const tools: Tool[] = [
    {
      name: 'patch_scene',
      description:
        'Apply a small validated diff to the architecture scene. Never rewrite the scene. Operations: add, update, remove, connect, disconnect, focus, retitle, question, resolve_question, tidy.',
      input_schema: {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            items: { type: 'object' },
          },
        },
        required: ['operations'],
      },
    },
    {
      name: 'log_decision',
      description: 'Record a design decision against component ids. chose, because, optional rejected, affects.',
      input_schema: {
        type: 'object',
        properties: {
          chose: { type: 'string' },
          because: { type: 'string' },
          rejected: { type: 'array', items: { type: 'string' } },
          affects: { type: 'array', items: { type: 'string' } },
        },
        required: ['chose', 'because', 'affects'],
      },
    },
    {
      name: 'run_simulation',
      description:
        'Run an illustrative flow, load, or step simulation. Numbers are not a capacity plan. mode, entry, optional rps, durationS, faults[{component, mode, factor}], machineId.',
      input_schema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['flow', 'load', 'step'] },
          entry: { type: 'string' },
          rps: { type: 'number' },
          durationS: { type: 'number' },
          faults: { type: 'array' },
          machineId: { type: 'string' },
        },
        required: ['mode', 'entry'],
      },
    },
  ]
  if (mode === 'grounded') {
    tools.push({
      name: 'read_shape',
      description:
        'Read allowlisted code structure or schema shape. Returns paths, type names and field names only. Never records, logs, tickets or example values. source must be repo-search or graphql-schema.',
      input_schema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['repo-search', 'graphql-schema'] },
          query: { type: 'string' },
        },
        required: ['source', 'query'],
      },
    })
  }
  return tools
}

export type Tool = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}
