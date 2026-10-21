import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Activity, PatchOp, Scene } from '../shared/types.ts'
import { emptyScene } from '../shared/types.ts'
import { applyPatches, logDecision, touchVersion } from '../shared/patch.ts'
import type { SessionRecord, SessionSummary } from '../shared/session.ts'
import { summariseSession } from '../shared/session.ts'
import { slugify } from '../shared/format.ts'

type IndexFile = { nextShort: number }

export class SessionStore {
  private readonly live = new Map<string, SessionRecord>()
  private readonly tails = new Map<string, Promise<void>>()

  constructor(private readonly root: string) {}

  exclusive(id: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(id) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.tails.set(id, next.then(() => undefined, () => undefined))
    return next
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    if (!(await this.readIndex())) {
      await this.writeIndex({ nextShort: 414 })
    }
  }

  async list(): Promise<SessionSummary[]> {
    const entries = await readdir(this.root, { withFileTypes: true })
    const sessions: SessionSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const session = await this.read(entry.name)
      if (session) sessions.push(summariseSession(session))
    }
    return sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  async create(input: { title: string; mode: 'blank' | 'grounded'; at?: string; sample?: boolean }): Promise<SessionRecord> {
    const at = input.at ?? new Date().toISOString()
    const id = await this.uniqueId(input.title, new Date(at))
    const index = await this.readIndex()
    const short = index?.nextShort ?? 414
    await this.writeIndex({ nextShort: short + 1 })
    const folder = path.join(this.root, id)
    await mkdir(folder, { recursive: true })
    const session: SessionRecord = {
      id,
      shortId: String(short).padStart(4, '0'),
      title: input.title.trim() || 'Untitled session',
      mode: input.mode,
      createdAt: at,
      updatedAt: at,
      folder,
      scene: emptyScene(input.title.trim() || 'Untitled session'),
      turns: [],
      activity: [],
      simulations: [],
      renders: [],
      versionNotes: [],
      sample: input.sample,
      usage: { inputTokens: 0, outputTokens: 0 },
    }
    await this.save(session)
    await this.writeScene(session)
    this.live.set(session.id, session)
    return session
  }

  async get(id: string): Promise<SessionRecord | null> {
    if (!isSafeId(id)) return null
    const cached = this.live.get(id)
    if (cached) return cached
    const session = await this.read(id)
    if (session) this.live.set(id, session)
    return session
  }

  async save(session: SessionRecord): Promise<void> {
    session.updatedAt = session.updatedAt || new Date().toISOString()
    const file = path.join(this.root, session.id, 'session.json')
    await mkdir(path.dirname(file), { recursive: true })
    this.live.set(session.id, session)
    await atomicWrite(file, JSON.stringify(session, null, 2))
  }

  async applyOps(session: SessionRecord, ops: PatchOp[], why: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!ops.length) return { ok: true }
    const applied = applyPatches(session.scene, ops)
    if (!applied.ok) return { ok: false, message: applied.issues.map((issue) => issue.message).join(' ') }
    session.scene = applied.scene
    session.versionNotes.push({ version: session.scene.version, why })
    const at = new Date().toISOString()
    for (const op of applied.applied) {
      session.activity.unshift({
        id: `a-${session.activity.length + 1}`,
        at,
        version: session.scene.version,
        tool: 'patch_scene',
        action: op.op,
        target: op.target,
        detail: op.detail,
        status: 'validated',
      })
    }
    await this.writeScene(session)
    return { ok: true }
  }

  async decide(
    session: SessionRecord,
    input: { chose: string; rejected?: string[]; because: string; affects: string[] },
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const logged = logDecision(session.scene, input)
    if (!logged.ok) return logged
    if (!session.versionNotes.some((note) => note.version === session.scene.version)) {
      session.scene = touchVersion(logged.scene)
      session.versionNotes.push({ version: session.scene.version, why: input.chose })
      await this.writeScene(session)
    } else {
      session.scene = logged.scene
      await this.writeScene(session)
    }
    session.versionNotes = session.versionNotes.map((note) =>
      note.version === session.scene.version ? { ...note, why: input.chose } : note,
    )
    session.activity.unshift({
      id: `a-${session.activity.length + 1}`,
      at: new Date().toISOString(),
      version: session.scene.version,
      tool: 'log_decision',
      action: 'add',
      target: logged.decision.id,
      detail: input.chose,
      status: 'decision',
    })
    return { ok: true }
  }

  async pushActivity(session: SessionRecord, activity: Activity): Promise<void> {
    session.activity.unshift(activity)
  }

  private async writeScene(session: SessionRecord): Promise<void> {
    const file = path.join(this.root, session.id, `scene.v${session.scene.version}.json`)
    await atomicWrite(file, JSON.stringify(session.scene, null, 2))
  }

  async readScene(id: string, version: number): Promise<Scene | null> {
    if (!isSafeId(id) || !Number.isInteger(version) || version < 0) return null
    try {
      const text = await readFile(path.join(this.root, id, `scene.v${version}.json`), 'utf8')
      return JSON.parse(text) as Scene
    } catch {
      return null
    }
  }

  private async read(id: string): Promise<SessionRecord | null> {
    try {
      const text = await readFile(path.join(this.root, id, 'session.json'), 'utf8')
      return JSON.parse(text) as SessionRecord
    } catch {
      return null
    }
  }

  private async uniqueId(title: string, date: Date): Promise<string> {
    const day = date.toISOString().slice(0, 10)
    const base = `${day}-${slugify(title) || 'session'}`.slice(0, 72)
    let id = base
    let n = 2
    while (await this.read(id)) {
      id = `${base}-${n}`
      n += 1
    }
    return id
  }

  private async readIndex(): Promise<IndexFile | null> {
    try {
      return JSON.parse(await readFile(path.join(this.root, 'index.json'), 'utf8')) as IndexFile
    } catch {
      return null
    }
  }

  private async writeIndex(index: IndexFile): Promise<void> {
    await atomicWrite(path.join(this.root, 'index.json'), JSON.stringify(index))
  }
}

function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(id)
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, contents)
  await rename(tmp, file)
}
