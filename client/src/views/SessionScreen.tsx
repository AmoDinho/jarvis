import { useEffect, useRef, useState } from 'react'
import type { Health, ServerEvent, SessionRecord } from '@shared/session'
import type { Scene, SimResult, ViewName } from '@shared/types'
import { formatElapsed, versionLabel } from '@shared/format'
import { api } from '../api.ts'
import { voice } from '../voice.ts'
import { Frame, Logo } from '../ui.tsx'
import { Orbital } from './Orbital.tsx'
import { Constellation } from './Constellation.tsx'
import { WarRoom } from './WarRoom.tsx'
import { Decisions } from './Decisions.tsx'
import { WriteUp } from './WriteUp.tsx'

export function SessionScreen({
  id,
  health,
  flat,
  setFlat,
  onBack,
  autostart,
  clearAutostart,
}: {
  id: string
  health: Health | null
  flat: boolean
  setFlat: (value: boolean) => void
  onBack: () => void
  autostart: string | null
  clearAutostart: () => void
}) {
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [phase, setPhase] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle')
  const [interim, setInterim] = useState('')
  const [reply, setReply] = useState('')
  const [partial, setPartial] = useState('')
  const [sim, setSim] = useState<SimResult | null>(null)
  const [narration, setNarration] = useState<string[]>([])
  const [sceneView, setSceneView] = useState<'orbital' | 'constellation' | 'warroom'>('orbital')
  const [panel, setPanel] = useState<'scene' | 'decisions' | 'writeup'>('scene')
  const [preview, setPreview] = useState<Scene | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>([])
  const [now, setNow] = useState(Date.now())
  const [renderHtml, setRenderHtml] = useState<{ title: string; html: string } | null>(null)
  const started = useRef(false)
  const interimRef = useRef('')
  const replyRef = useRef('')
  const flatRef = useRef(flat)
  flatRef.current = flat

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const source = new EventSource(`/api/sessions/${id}/events`)
    const listen = (type: string, apply: (event: ServerEvent) => void) => {
      source.addEventListener(type, (message) => apply(JSON.parse((message as MessageEvent).data) as ServerEvent))
    }
    listen('hello', (event) => {
      if (event.type !== 'hello') return
      setSession(event.session)
      const latest = event.session.simulations[0]
      if (latest) setSim(latest)
      if (event.session.reply) setReply(event.session.reply)
    })
    listen('status', (event) => {
      if (event.type === 'status' && event.phase !== 'idle') setPhase(event.phase)
    })
    listen('speech.sentence', (event) => {
      if (event.type !== 'speech.sentence') return
      replyRef.current = `${replyRef.current} ${event.text}`.trim()
      setReply(replyRef.current)
      setPartial('')
      setPhase('speaking')
      if (!voice.listening) voice.speak(event.text)
    })
    listen('speech.partial', (event) => {
      if (event.type === 'speech.partial') setPartial(event.text)
    })
    listen('scene', (event) => {
      if (event.type !== 'scene') return
      setSession((current) => (current ? { ...current, scene: event.scene, activity: event.activity, versionNotes: event.versionNotes } : current))
      setPreview(null)
    })
    listen('simulation', (event) => {
      if (event.type !== 'simulation') return
      setSim(event.result)
      setNarration(event.narration)
      setSession((current) => (current ? { ...current, simulations: [event.result, ...current.simulations].slice(0, 8) } : current))
    })
    listen('view', (event) => {
      if (event.type !== 'view') return
      show(event.view)
    })
    listen('writeup', (event) => {
      if (event.type !== 'writeup') return
      setSession((current) => (current ? { ...current, spec: event.spec } : current))
      setPanel('writeup')
    })
    listen('render', (event) => {
      if (event.type !== 'render') return
      setSession((current) =>
        current ? { ...current, renders: [event.render, ...current.renders.filter((item) => item.id !== event.render.id)] } : current,
      )
    })
    listen('error', (event) => {
      if (event.type === 'error') setError(event.message)
    })
    listen('turn.done', () => setPhase('idle'))
    return () => source.close()
  }, [id])

  useEffect(() => {
    if (!session || !autostart || started.current) return
    started.current = true
    clearAutostart()
    void send(autostart)
  }, [session, autostart, clearAutostart])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.repeat) return
      const target = event.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      if (event.code === 'Space' && !typing) {
        event.preventDefault()
        voice.stopSpeaking()
        void api.interrupt(id)
        setPhase('listening')
        interimRef.current = ''
        setInterim('')
        void voice.listen({
          onInterim: (text) => {
            interimRef.current = text
            setInterim(text)
          },
          onFinal: () => undefined,
          onError: setError,
          onLevel: setLevels,
        })
      }
      if (!typing && (event.key === 'f' || event.key === 'F')) setFlat(!flatRef.current)
      if (event.key === 'Escape') {
        voice.stopSpeaking()
        setPanel('scene')
        setRenderHtml(null)
      }
      if (!typing && event.key === '1') show('orbital')
      if (!typing && event.key === '2') show('constellation')
      if (!typing && event.key === '3') show('warroom')
      if (!typing && (event.key === 'd' || event.key === 'D')) setPanel('decisions')
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const pending = interimRef.current
      voice.stopListening((text) => void send(text), pending)
      interimRef.current = ''
      setInterim('')
      if (!pending.trim()) setPhase('idle')
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      voice.stopListening()
    }
  }, [id, setFlat])

  function show(view: ViewName) {
    if (view === 'decisions' || view === 'writeup') setPanel(view)
    else {
      setPanel('scene')
      setSceneView(view)
    }
  }

  async function send(text: string) {
    const clean = text.trim()
    if (!clean) {
      setPhase('idle')
      return
    }
    replyRef.current = ''
    setReply('')
    setPartial('')
    setError(null)
    setPhase('thinking')
    try {
      await api.turn(id, clean)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Turn failed.')
      setPhase('idle')
    }
  }

  async function focus(componentId: string) {
    await api.focus(id, componentId)
  }

  async function openRender(renderId: string, title: string) {
    const html = await api.renderHtml(id, renderId)
    setRenderHtml({ title, html })
  }

  if (!session) {
    return (
      <Frame className="session">
        <header className="topbar">
          <Logo onClick={onBack} />
          <p className="kicker">{health ? 'Connecting the scene' : 'Waiting for the local server'}</p>
        </header>
      </Frame>
    )
  }

  const scene = preview ?? session.scene
  const elapsed = formatElapsed(now - Date.parse(session.createdAt))
  const patches = session.activity.filter((item) => item.version === session.scene.version && item.tool === 'patch_scene').length
  const speech = phase === 'listening' ? interim : `${reply} ${partial}`.trim()
  const war = panel === 'scene' && sceneView === 'warroom'

  return (
    <Frame className={`session ${war ? 'war' : ''}`}>
      {panel === 'decisions' ? (
        <Decisions session={session} onBack={() => setPanel('scene')} onWrite={() => void api.writeup(id)} onResolve={(text) => void api.resolve(id, text)} onPreview={(version) => void previewVersion(version)} />
      ) : panel === 'writeup' && session.spec ? (
        <WriteUp session={session} onDecisions={() => setPanel('decisions')} />
      ) : war ? (
        <WarRoom
          session={session}
          scene={scene}
          sim={sim}
          narration={narration}
          phase={phase}
          levels={levels}
          onFocus={(componentId) => void focus(componentId)}
          onView={show}
          onTalk={() => undefined}
          flat={flat}
        />
      ) : (
        <>
          <header className="topbar session-head">
            <div>
              <Logo subtitle={`${session.title} · ${versionLabel(session.scene.version)}`} onClick={onBack} />
              <p className="session-meta">
                Session {session.shortId} · {session.title}
                <br />
                Context · {session.mode}
                {session.sample ? ' · sample' : ''}
                <br />
                {elapsed}
              </p>
            </div>
            <div className="tabs" role="tablist">
              {(['orbital', 'constellation', 'warroom'] as const).map((view) => (
                <button key={view} type="button" className={sceneView === view ? 'on' : ''} onClick={() => show(view)}>
                  {view === 'warroom' ? 'War room' : view}
                </button>
              ))}
            </div>
            <div className="quiet-nav">
              <button type="button" onClick={() => setPanel('decisions')}>
                Decisions
              </button>
              <button type="button" onClick={() => void api.writeup(id)}>
                Write up
              </button>
            </div>
            <div className="version-block">
              <span className="kicker">Scene version</span>
              <em>{patches ? `+${patches} patches` : health?.brain === 'demo' ? 'demo architect' : health?.model ?? ''}</em>
              <strong>{versionLabel(session.scene.version).slice(1)}</strong>
            </div>
          </header>
          <div className="stage">
            {sceneView === 'constellation' ? (
              <Constellation
                session={session}
                scene={scene}
                phase={phase}
                speech={speech}
                levels={levels}
                onFocus={(componentId) => void focus(componentId)}
                onSend={(text) => void send(text)}
                onTrace={(entry) => void api.simulate(id, { mode: 'flow', entry, prompt: `Trace from ${entry}` })}
                onOpenRender={(renderId, title) => void openRender(renderId, title)}
                onDecisions={() => setPanel('decisions')}
              />
            ) : (
              <Orbital
                session={session}
                scene={scene}
                previewing={Boolean(preview)}
                sim={sim}
                phase={phase}
                interim={interim}
                levels={levels}
                onFocus={(componentId) => void focus(componentId)}
                onSend={(text) => void send(text)}
                onPreview={(version) => void previewVersion(version)}
                onClearPreview={() => setPreview(null)}
                onOpenRender={(renderId, title) => void openRender(renderId, title)}
                onDecisions={() => setPanel('decisions')}
                speech={speech}
              />
            )}
            {renderHtml ? (
              <aside className="render-panel">
                <header>
                  <span>{renderHtml.title}</span>
                  <button type="button" className="press" onClick={() => setRenderHtml(null)}>
                    Close
                  </button>
                </header>
                <iframe sandbox="allow-scripts" srcDoc={renderHtml.html} title={renderHtml.title} />
              </aside>
            ) : null}
          </div>
        </>
      )}
      {error ? <p className="error-line">{error}</p> : null}
    </Frame>
  )

  async function previewVersion(version: number) {
    if (version === session?.scene.version) {
      setPreview(null)
      return
    }
    const snap = await api.snapshot(id, version)
    setPreview(snap.scene)
    setPanel('scene')
    setSceneView('orbital')
  }
}
