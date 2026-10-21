import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PatchOp, Scenario } from '../shared/types.ts'
import { simulate } from '../shared/simulate.ts'
import { narrateSimulation } from '../shared/narrate.ts'
import { buildSpec } from '../shared/spec.ts'
import { readShape } from '../shared/shape.ts'
import { limitSentences, speakable } from '../shared/speech.ts'
import type { ServerEvent, SessionRecord } from '../shared/session.ts'
import { planTurn, type TurnPlan } from './architect.ts'
import { claudeTurn, type ClaudeBlock } from './claude.ts'
import { config, type Brain } from './config.ts'
import { scenePng, sceneSvg } from './diagram.ts'
import { systemPrompt } from './prompt.ts'
import { builtinRender, queuedRender, sanitizeRenderHtml } from './renders.ts'
import { SessionStore } from './store.ts'
import { toolDefinitions } from './tools.ts'

type Emit = (id: string, event: ServerEvent) => void

export class Orchestrator {
  private inflight = new Map<string, AbortController>()

  constructor(
    private readonly store: SessionStore,
    private readonly emit: Emit,
    private readonly settings = config(),
  ) {}

  interrupt(id: string): void {
    this.inflight.get(id)?.abort()
  }

  async select(session: SessionRecord, id: string | null): Promise<void> {
    if (id && !session.scene.components.some((c) => c.id === id)) return
    session.scene = { ...session.scene, focus: id ?? undefined }
    await this.store.save(session)
    this.emitScene(session)
  }

  async directSimulation(session: SessionRecord, scenario: Scenario): Promise<void> {
    const spoken: string[] = []
    await this.runSimulation(session, scenario, scenario.prompt ?? scenario.mode, spoken)
    if (spoken.length) session.reply = spoken.join(' ')
    await this.store.save(session)
    this.emit(session.id, { type: 'turn.done' })
    this.emit(session.id, { type: 'status', phase: 'idle' })
  }

  async writeUpNow(session: SessionRecord): Promise<void> {
    const spoken: string[] = []
    await this.writeUp(session, spoken)
    if (spoken.length) {
      session.reply = spoken.join(' ')
      session.turns.push({ id: `t-${session.turns.length + 1}`, role: 'jarvis', text: session.reply, at: new Date().toISOString() })
    }
    await this.store.save(session)
    this.emit(session.id, { type: 'turn.done' })
    this.emit(session.id, { type: 'status', phase: 'idle' })
  }

  async turn(session: SessionRecord, text: string): Promise<void> {
    const controller = new AbortController()
    this.inflight.set(session.id, controller)
    const spoken: string[] = []
    try {
      session.turns.push({ id: `t-${session.turns.length + 1}`, role: 'user', text, at: new Date().toISOString() })
      if (this.overBudget(session)) {
        await this.speak(session, ['This session has hit its token ceiling.', 'Raise JARVIS_TOKEN_BUDGET, or keep going in demo mode.'], spoken)
        return
      }
      if (this.settings.brain === 'claude') {
        await this.claude(session, text, controller.signal, spoken)
      } else {
        await this.demo(session, text, spoken)
      }
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : 'The turn failed.'
      this.emit(session.id, { type: 'error', message })
      if (!spoken.length) await this.speak(session, ['Something went wrong on that turn.', message], spoken)
    } finally {
      this.inflight.delete(session.id)
      if (spoken.length) {
        session.reply = spoken.join(' ')
        session.turns.push({
          id: `t-${session.turns.length + 1}`,
          role: 'jarvis',
          text: session.reply,
          at: new Date().toISOString(),
        })
      }
      this.emit(session.id, { type: 'usage', inputTokens: session.usage.inputTokens, outputTokens: session.usage.outputTokens })
      this.emit(session.id, { type: 'turn.done' })
      this.emit(session.id, { type: 'status', phase: 'idle' })
      await this.store.save(session)
    }
  }

  queueRender(session: SessionRecord, componentId: string, why: string, keep = false): void {
    const component = session.scene.components.find((c) => c.id === componentId)
    if (!component) return
    const render = queuedRender({
      id: `r-${String(session.renders.length + 1).padStart(3, '0')}`,
      tier: 2,
      componentId,
      title: component.label,
      why,
    })
    session.renders.unshift(render)
    session.activity.unshift({
      id: `a-${session.activity.length + 1}`,
      at: new Date().toISOString(),
      version: session.scene.version,
      tool: 'render',
      action: 'queue',
      target: componentId,
      detail: why,
      status: 'render_queued',
    })
    this.emit(session.id, { type: 'render', render })
    const delay = this.settings.brain === 'demo' ? 1200 : 0
    setTimeout(() => {
      void this.store.exclusive(session.id, () => this.finishRender(session.id, render.id, keep)).catch((error) => {
        console.error('render failed', error)
      })
    }, delay)
  }

  async keepLatest(session: SessionRecord): Promise<void> {
    const render = session.renders.find((item) => item.status === 'ready' || item.status === 'queued')
    if (!render) {
      const focus = session.scene.focus
      if (focus) this.queueRender(session, focus, 'Kept from the live HUD.', true)
      return
    }
    render.tier = 3
    render.status = render.status === 'queued' ? 'queued' : 'kept'
    this.emit(session.id, { type: 'render', render })
  }

  private async demo(session: SessionRecord, text: string, spoken: string[]): Promise<void> {
    const plan = planTurn({ text, scene: session.scene, mode: session.mode, lastScenario: session.lastScenario })
    if (plan.view) this.emit(session.id, { type: 'view', view: plan.view })
    if (!plan.simulation && !plan.writeUp && plan.sentences.length) await this.speak(session, plan.sentences, spoken)
    const applied = await this.applyPlan(session, plan)
    if (!applied.ok) {
      await this.speak(session, ['I could not apply that edit.', applied.message], spoken)
      return
    }
    if (plan.simulation) await this.runSimulation(session, plan.simulation, text, spoken)
    if (plan.escalate) this.queueRender(session, plan.escalate.componentId, plan.escalate.why)
    if (plan.keepRender) await this.keepLatest(session)
    if (plan.writeUp) await this.writeUp(session, spoken)
  }

  private async claude(session: SessionRecord, text: string, signal: AbortSignal, spoken: string[]): Promise<void> {
    if (!this.settings.apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Use JARVIS_BRAIN=demo to test without it.')
    this.emit(session.id, { type: 'status', phase: 'thinking' })
    const messages: unknown[] = []
    for (const turn of session.turns.slice(-6)) {
      if (!turn.text) continue
      messages.push({ role: turn.role === 'jarvis' ? 'assistant' : 'user', content: turn.text })
    }
    if (!messages.length || (messages[0] as { role: string }).role !== 'user') {
      messages.unshift({ role: 'user', content: 'Begin.' })
    }
    const tools = toolDefinitions(session.mode)
    let round = 0
    while (round < 3) {
      if (signal.aborted) return
      const result = await claudeTurn({
        apiKey: this.settings.apiKey,
        model: this.settings.model,
        system: systemPrompt(session),
        messages,
        tools,
        signal,
        hooks: {
          onPartial: (partial) => this.emit(session.id, { type: 'speech.partial', text: partial }),
          onSentence: (sentence) => {
            const clean = speakable(sentence)
            if (!clean) return
            spoken.push(clean)
            this.emit(session.id, { type: 'status', phase: 'speaking' })
            this.emit(session.id, { type: 'speech.sentence', text: clean })
          },
        },
      })
      session.usage.inputTokens += result.usage.inputTokens
      session.usage.outputTokens += result.usage.outputTokens
      if (!result.toolUses.length || result.stopReason !== 'tool_use') break
      const results = []
      for (const tool of result.toolUses) {
        if (signal.aborted) return
        const output = await this.execTool(session, tool.name, tool.input, text, spoken)
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(output).slice(0, 12_000) })
      }
      messages.push({ role: 'assistant', content: blocksForApi(result.blocks) })
      messages.push({ role: 'user', content: results })
      round += 1
    }
    if (!spoken.length) {
      await this.speak(session, ['The scene is updated.', 'Ask me to walk a request, or to write it up.'], spoken)
    }
  }

  private async execTool(
    session: SessionRecord,
    name: string,
    input: unknown,
    utterance: string,
    spoken: string[],
  ): Promise<unknown> {
    const body = (input ?? {}) as Record<string, unknown>
    if (name === 'read_shape') {
      if (session.mode !== 'grounded') return { error: 'read_shape is not available in blank slate.' }
      return readShape(String(body.source ?? ''), String(body.query ?? ''))
    }
    if (name === 'patch_scene') {
      const operations = Array.isArray(body.operations) ? (body.operations as PatchOp[]) : []
      const applied = await this.store.applyOps(session, operations, 'Claude edit')
      if (!applied.ok) return { error: applied.message }
      this.emitScene(session)
      return { version: session.scene.version, focus: session.scene.focus }
    }
    if (name === 'log_decision') {
      const decided = await this.store.decide(session, {
        chose: String(body.chose ?? ''),
        because: String(body.because ?? ''),
        rejected: Array.isArray(body.rejected) ? body.rejected.map(String) : undefined,
        affects: Array.isArray(body.affects) ? body.affects.map(String) : [],
      })
      if (!decided.ok) return { error: decided.message }
      this.emitScene(session)
      return { ok: true, decisions: session.scene.decisions.length }
    }
    if (name === 'run_simulation') {
      const scenario: Scenario = {
        mode: body.mode === 'load' || body.mode === 'step' ? body.mode : 'flow',
        entry: String(body.entry ?? session.scene.components[0]?.id ?? ''),
        rps: typeof body.rps === 'number' ? body.rps : undefined,
        durationS: typeof body.durationS === 'number' ? body.durationS : undefined,
        faults: Array.isArray(body.faults) ? (body.faults as Scenario['faults']) : undefined,
        machineId: typeof body.machineId === 'string' ? body.machineId : undefined,
        prompt: utterance,
      }
      await this.runSimulation(session, scenario, utterance, spoken)
      return { summary: session.simulations[0]?.summary, narration: narrateSimulation(session.scene, session.simulations[0]!) }
    }
    return { error: `Unknown tool ${name}` }
  }

  private async applyPlan(session: SessionRecord, plan: TurnPlan): Promise<{ ok: true } | { ok: false; message: string }> {
    for (const batch of plan.batches) {
      const applied = await this.store.applyOps(session, batch.ops, batch.why)
      if (!applied.ok) return applied
      this.emitScene(session)
    }
    const decisions = [...(plan.decisions ?? []), ...(plan.decision ? [plan.decision] : [])]
    for (const decision of decisions) {
      const affects = decision.affects.filter((id) => session.scene.components.some((c) => c.id === id))
      const decided = await this.store.decide(session, { ...decision, affects })
      if (!decided.ok) return decided
      this.emitScene(session)
    }
    return { ok: true }
  }

  private async runSimulation(session: SessionRecord, scenario: Scenario | 'last', utterance: string, spoken: string[]): Promise<void> {
    const resolved = scenario === 'last' ? session.lastScenario : scenario
    if (!resolved) {
      await this.speak(session, ['There is no simulation to re-run.', 'Ask what happens at a given rate first.'], spoken)
      return
    }
    const next = { ...resolved, prompt: resolved.prompt ?? utterance }
    let result
    try {
      result = simulate(session.scene, next)
    } catch (error) {
      await this.speak(session, ['I could not run that simulation.', error instanceof Error ? error.message : 'Check the entry point.'], spoken)
      return
    }
    session.lastScenario = next
    session.simulations.unshift(result)
    session.simulations = session.simulations.slice(0, 8)
    session.activity.unshift({
      id: `a-${session.activity.length + 1}`,
      at: new Date().toISOString(),
      version: session.scene.version,
      tool: 'run_simulation',
      action: result.mode,
      target: result.entry,
      detail: `${result.summary.bottleneck} · illustrative`,
      status: 'simulation',
    })
    const narration = narrateSimulation(session.scene, result)
    this.emit(session.id, { type: 'simulation', result, narration })
    this.emit(session.id, { type: 'view', view: result.mode === 'flow' ? 'orbital' : 'warroom' })
    if (this.settings.brain === 'demo') await this.speak(session, narration, spoken)
  }

  private async writeUp(session: SessionRecord, spoken: string[]): Promise<void> {
    const folder = path.relative(process.cwd(), session.folder)
    const files = [
      { name: 'spec.md', note: 'markdown' },
      { name: 'hud-final.svg', note: 'diagram' },
      { name: 'hud-final.png', note: 'diagram' },
      { name: `scene.v1 … v${session.scene.version}.json`, note: `${session.scene.version + 1} files` },
    ]
    const spec = buildSpec({
      scene: session.scene,
      folder,
      generatedAt: new Date().toISOString(),
      startedAt: session.createdAt,
      turns: session.turns.filter((turn) => turn.role === 'user').length,
      simulations: session.simulations,
      evolution: session.versionNotes,
      files,
    })
    await mkdir(session.folder, { recursive: true })
    await writeFile(path.join(session.folder, 'spec.md'), spec.markdown)
    await writeFile(path.join(session.folder, 'hud-final.svg'), sceneSvg(session.scene))
    await writeFile(path.join(session.folder, 'hud-final.png'), scenePng(session.scene))
    session.spec = spec
    session.activity.unshift({
      id: `a-${session.activity.length + 1}`,
      at: new Date().toISOString(),
      version: session.scene.version,
      tool: 'writeup',
      action: 'write',
      target: 'spec.md',
      detail: folder,
      status: 'validated',
    })
    this.emit(session.id, { type: 'writeup', spec })
    this.emit(session.id, { type: 'view', view: 'writeup' })
    const snaps = spec.evolution.length
    const questions = spec.questions.length
    await this.speak(
      session,
      [`Written up — seven sections and ${snaps} key snapshots.`, questions ? `${questions} ${questions === 1 ? 'question is' : 'questions are'} still open.` : 'No questions left open.'],
      spoken,
    )
  }

  private async finishRender(sessionId: string, renderId: string, keep: boolean): Promise<void> {
    const session = await this.store.get(sessionId)
    if (!session) return
    const render = session.renders.find((item) => item.id === renderId)
    const component = session.scene.components.find((c) => c.id === render?.componentId)
    if (!render || !component) return
    let html = builtinRender(component, render.why)
    if (this.settings.brain === 'claude' && this.settings.apiKey) {
      try {
        html = await this.claudeRender(component.label, render.why)
      } catch {
        html = builtinRender(component, render.why)
      }
    }
    const clean = sanitizeRenderHtml(html)
    const file = path.join(session.folder, 'renders', `${render.id}.html`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, clean.html)
    render.file = file
    render.status = keep ? 'kept' : 'ready'
    if (keep) render.tier = 3
    render.readyAt = new Date().toISOString()
    await this.store.save(session)
    this.emit(sessionId, { type: 'render', render })
    this.emit(sessionId, {
      type: 'speech.sentence',
      text: `Render ready: ${component.label}. I can walk it whenever you pause.`,
    })
  }

  private async claudeRender(label: string, why: string): Promise<string> {
    const result = await claudeTurn({
      apiKey: this.settings.apiKey,
      model: this.settings.renderModel,
      system:
        'Write one self-contained HTML document. Dark holographic HUD, cyan on near-black. Inline CSS and JS only. No network, no external assets, no parent frame access. Explain the idea interactively.',
      messages: [{ role: 'user', content: `Illustrate ${label}. ${why}` }],
      tools: [],
      maxTokens: 4096,
    })
    const html = result.text.match(/<!doctype html[\s\S]*<\/html>/i)?.[0] ?? result.text
    return html
  }

  private async speak(session: SessionRecord, sentences: string[], spoken: string[]): Promise<void> {
    for (const sentence of limitSentences(sentences.map(speakable).filter(Boolean))) {
      spoken.push(sentence)
      this.emit(session.id, { type: 'status', phase: 'speaking' })
      this.emit(session.id, { type: 'speech.sentence', text: sentence })
    }
  }

  private emitScene(session: SessionRecord): void {
    this.emit(session.id, {
      type: 'scene',
      scene: session.scene,
      activity: session.activity.slice(0, 40),
      versionNotes: session.versionNotes,
    })
  }

  private overBudget(session: SessionRecord): boolean {
    if (!this.settings.budget) return false
    return session.usage.inputTokens + session.usage.outputTokens >= this.settings.budget
  }
}

function blocksForApi(blocks: ClaudeBlock[]): unknown[] {
  return blocks.map((block) => {
    if (block.type === 'tool_use') {
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} }
    }
    if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking ?? '', signature: block.signature ?? '' }
    if (block.type === 'text') return { type: 'text', text: block.text ?? '' }
    return { type: block.type }
  })
}

export function brainLabel(mode: Brain): Brain {
  return mode
}
