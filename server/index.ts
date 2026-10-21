import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { config, loadEnv } from './config.ts'
import { Orchestrator } from './orchestrator.ts'
import { ensureSamples } from './samples.ts'
import { SessionStore } from './store.ts'
import type { ServerEvent } from '../shared/session.ts'
import type { Scenario } from '../shared/types.ts'

loadEnv()

const settings = config()
const store = new SessionStore(settings.sessionsDir)
const hub = new Map<string, Set<ServerResponse>>()

function emit(id: string, event: ServerEvent): void {
  const clients = hub.get(id)
  if (!clients) return
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  for (const client of clients) client.write(payload)
}

const orchestrator = new Orchestrator(store, emit, settings)

await store.init()
await ensureSamples(store)

const server = createServer((req, res) => {
  void handle(req, res)
})

server.listen(settings.port, () => {
  console.log(`JARVIS server on http://127.0.0.1:${settings.port}`)
})

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${settings.port}`)
    if (req.method === 'OPTIONS') {
      cors(res)
      res.writeHead(204)
      res.end()
      return
    }
    if (url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        port: settings.port,
        brain: settings.brain,
        model: settings.model,
        speech: 'browser',
        grounded: {
          allowlist: settings.allowlist,
          live: false,
          note: 'Local shape catalog. repo-search and graphql-schema are allowlisted, not connected as live MCP.',
        },
        budget: settings.budget,
      })
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      return json(res, 200, { sessions: await store.list() })
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const body = await readJson(req)
      const title = String(body.title ?? 'Untitled session')
      const mode = body.mode === 'grounded' ? 'grounded' : 'blank'
      const session = await store.create({ title, mode })
      return json(res, 201, { session })
    }
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([a-z0-9][a-z0-9-]{0,80})(?:\/(.*))?$/)
    if (!sessionMatch) return serveStatic(url.pathname, res)
    const id = sessionMatch[1]!
    const rest = sessionMatch[2] ?? ''
    const session = await store.get(id)
    if (!session) return json(res, 404, { error: 'No such session.' })

    if (req.method === 'GET' && rest === '') return json(res, 200, { session })
    if (req.method === 'GET' && rest === 'events') return stream(id, res)
    if (req.method === 'POST' && rest === 'turns') {
      const body = await readJson(req)
      const text = String(body.text ?? '').trim()
      if (!text) return json(res, 400, { error: 'Say something first.' })
      json(res, 202, { ok: true })
      await store.exclusive(id, async () => {
        const current = await store.get(id)
        if (current) await orchestrator.turn(current, text)
      })
      return
    }
    if (req.method === 'POST' && rest === 'interrupt') {
      orchestrator.interrupt(id)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && rest === 'focus') {
      const body = await readJson(req)
      await store.exclusive(id, async () => {
        const current = await store.get(id)
        if (current) await orchestrator.select(current, body.id ? String(body.id) : null)
      })
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && rest === 'simulate') {
      const body = await readJson(req)
      const scenario = body as Scenario
      json(res, 202, { ok: true })
      await store.exclusive(id, async () => {
        const current = await store.get(id)
        if (current) await orchestrator.directSimulation(current, scenario)
      })
      return
    }
    if (req.method === 'POST' && rest === 'writeup') {
      json(res, 202, { ok: true })
      await store.exclusive(id, async () => {
        const current = await store.get(id)
        if (current) await orchestrator.writeUpNow(current)
      })
      return
    }
    if (req.method === 'POST' && rest === 'tidy') {
      await store.exclusive(id, async () => {
        const current = await store.get(id)
        if (!current) return
        await store.applyOps(current, [{ op: 'tidy' }], 'Tidied the grid')
        await store.save(current)
        emit(id, { type: 'scene', scene: current.scene, activity: current.activity.slice(0, 40), versionNotes: current.versionNotes })
      })
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && rest === 'questions/resolve') {
      const body = await readJson(req)
      await store.exclusive(id, async () => {
        const current = await store.get(id)
        if (!current) return
        await store.applyOps(current, [{ op: 'resolve_question', text: String(body.text ?? '') }], 'Resolved a question')
        await store.save(current)
        emit(id, { type: 'scene', scene: current.scene, activity: current.activity.slice(0, 40), versionNotes: current.versionNotes })
      })
      return json(res, 200, { ok: true })
    }
    const version = rest.match(/^scenes\/(\d+)$/)
    if (req.method === 'GET' && version) {
      const scene = await store.readScene(id, Number(version[1]))
      if (!scene) return json(res, 404, { error: 'No such snapshot.' })
      return json(res, 200, { scene })
    }
    if (req.method === 'GET' && rest === 'spec.md') {
      const file = path.join(session.folder, 'spec.md')
      const text = await readFile(file, 'utf8')
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', ...corsHeaders() })
      res.end(text)
      return
    }
    if (req.method === 'GET' && rest === 'hud.svg') {
      const file = path.join(session.folder, 'hud-final.svg')
      const text = await readFile(file, 'utf8')
      res.writeHead(200, { 'content-type': 'image/svg+xml', ...corsHeaders() })
      res.end(text)
      return
    }
    const render = rest.match(/^renders\/(r-\d+)$/)
    if (req.method === 'GET' && render) {
      const file = path.join(session.folder, 'renders', `${render[1]}.html`)
      const text = await readFile(file, 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() })
      res.end(text)
      return
    }
    if (req.method === 'POST' && rest === 'reveal') {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      execFile(opener, [session.folder], () => undefined)
      return json(res, 200, { folder: path.relative(process.cwd(), session.folder) })
    }
    return json(res, 404, { error: 'No such route.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed.'
    if (!res.headersSent) json(res, 500, { error: message })
    else res.end()
  }
}

function stream(id: string, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    ...corsHeaders(),
  })
  const clients = hub.get(id) ?? new Set()
  clients.add(res)
  hub.set(id, clients)
  void store.get(id).then((session) => {
    if (session) emit(id, { type: 'hello', session })
  })
  const ping = setInterval(() => res.write(': ping\n\n'), 15000)
  res.on('close', () => {
    clearInterval(ping)
    clients.delete(res)
  })
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const dist = path.resolve('dist')
  const requested = pathname === '/' ? '/index.html' : pathname
  const file = path.resolve(dist, `.${requested}`)
  if (!file.startsWith(dist)) return json(res, 403, { error: 'Forbidden.' })
  try {
    await access(file)
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const type = file.endsWith('.html')
      ? 'text/html'
      : file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.svg')
            ? 'image/svg+xml'
            : 'application/octet-stream'
    res.writeHead(200, { 'content-type': type })
    createReadStream(file).pipe(res)
  } catch {
    json(res, 404, { error: 'Not found. Run the client with npm run dev, or build it first.' })
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function cors(res: ServerResponse): void {
  for (const [key, value] of Object.entries(corsHeaders())) res.setHeader(key, value)
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > 1_000_000) throw new Error('Body too large.')
    chunks.push(buf)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}
