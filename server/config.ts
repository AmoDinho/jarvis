import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { GROUNDED_ALLOWLIST } from '../shared/shape.ts'

export type Brain = 'demo' | 'claude'

export function loadEnv(root = process.cwd()): void {
  const file = path.join(root, '.env')
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function brain(): Brain {
  const pref = process.env.JARVIS_BRAIN ?? 'auto'
  if (pref === 'demo') return 'demo'
  if (pref === 'claude') return 'claude'
  return process.env.ANTHROPIC_API_KEY ? 'claude' : 'demo'
}

export function config() {
  return {
    port: Number(process.env.JARVIS_PORT ?? 8787),
    brain: brain(),
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    renderModel: process.env.ANTHROPIC_RENDER_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    budget: process.env.JARVIS_TOKEN_BUDGET ? Number(process.env.JARVIS_TOKEN_BUDGET) : null,
    sessionsDir: path.resolve(process.env.JARVIS_SESSIONS ?? path.join(process.cwd(), 'sessions')),
    allowlist: [...GROUNDED_ALLOWLIST],
  }
}
