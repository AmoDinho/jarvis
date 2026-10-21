import type { Activity, RenderJob, Scenario, Scene, SimResult, ViewName } from './types.ts'
import type { SpecDocument } from './spec.ts'

export type TranscriptTurn = {
  id: string
  role: 'user' | 'jarvis'
  text: string
  at: string
}

export type SessionRecord = {
  id: string
  shortId: string
  title: string
  mode: 'blank' | 'grounded'
  createdAt: string
  updatedAt: string
  folder: string
  scene: Scene
  turns: TranscriptTurn[]
  activity: Activity[]
  simulations: SimResult[]
  renders: RenderJob[]
  versionNotes: { version: number; why: string }[]
  lastScenario?: Scenario
  spec?: SpecDocument
  sample?: boolean
  usage: { inputTokens: number; outputTokens: number }
  reply?: string
}

export type SessionSummary = {
  id: string
  shortId: string
  title: string
  mode: 'blank' | 'grounded'
  updatedAt: string
  createdAt: string
  version: number
  decisions: number
  components: number
  specWritten: boolean
  sample: boolean
  blurb: string
}

export type Health = {
  ok: true
  port: number
  brain: 'demo' | 'claude'
  model: string
  speech: 'browser'
  grounded: { allowlist: string[]; live: false; note: string }
  budget: number | null
}

export type ServerEvent =
  | { type: 'hello'; session: SessionRecord }
  | { type: 'status'; phase: 'thinking' | 'speaking' | 'idle' }
  | { type: 'speech.sentence'; text: string }
  | { type: 'speech.partial'; text: string }
  | { type: 'scene'; scene: Scene; activity: Activity[]; versionNotes: SessionRecord['versionNotes'] }
  | { type: 'simulation'; result: SimResult; narration: string[] }
  | { type: 'render'; render: RenderJob }
  | { type: 'view'; view: ViewName }
  | { type: 'writeup'; spec: SpecDocument }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
  | { type: 'turn.done' }

export function summariseSession(session: SessionRecord): SessionSummary {
  const machine = session.scene.components.some((c) => c.machine)
  const blurb = session.spec
    ? 'spec written'
    : machine
      ? 'state machine'
      : `${session.scene.decisions.length} decisions`
  return {
    id: session.id,
    shortId: session.shortId,
    title: session.title,
    mode: session.mode,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    version: session.scene.version,
    decisions: session.scene.decisions.length,
    components: session.scene.components.length,
    specWritten: Boolean(session.spec),
    sample: Boolean(session.sample),
    blurb,
  }
}
