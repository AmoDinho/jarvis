import { useEffect, useRef, useState } from 'react'
import type { Health, SessionSummary } from '@shared/session'
import { formatDay, versionLabel } from '@shared/format'
import { api } from '../api.ts'
import { Frame, Logo, Rings } from '../ui.tsx'

const PROMPTS = [
  { text: 'Load the publish flow as it is today', note: 'Grounded · seed scene' },
  { text: 'What happens at 500 rps?', note: 'Opens war room' },
  { text: 'Keep this one', note: 'Keep the figure' },
  { text: 'Write it up', note: 'Spec + diagrams' },
]

const PLACES = [
  { left: '72%', top: '24%' },
  { left: '28%', top: '74%' },
  { left: '74%', top: '72%' },
]

export function StartScreen({
  health,
  offline,
  sessions,
  onOpen,
  onAutostart,
}: {
  health: Health | null
  offline: boolean
  sessions: SessionSummary[]
  onOpen: (id: string) => void
  onAutostart: (phrase: string) => void
}) {
  const [title, setTitle] = useState('Publish flow v2 — async compile')
  const [mode, setMode] = useState<'blank' | 'grounded'>('grounded')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const demoRan = useRef(false)

  async function begin(phrase?: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await api.create(title.trim() || 'Untitled session', mode)
      if (phrase) onAutostart(phrase)
      onOpen(created.session.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a session.')
      setBusy(false)
    }
  }

  useEffect(() => {
    const demo = new URLSearchParams(location.search).get('demo')
    if (!demoRan.current && (demo === 'publish' || demo === 'full')) {
      demoRan.current = true
      void begin(demo === 'full' ? 'Assemble the publish flow demo' : 'Load the publish flow as it is today')
    }
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return
      event.preventDefault()
      void begin()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
    // begin is stable enough for the first paint; title and mode are read at press time via closure refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, mode, busy])

  return (
    <Frame className="start">
      <header className="topbar">
        <Logo />
        <div className="status">
          <span className={offline ? 'bad' : 'ok'}>Local server :{health?.port ?? 8787}</span>
          <span>Voice · browser speech</span>
          <span>Mic · {typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition) ? 'ready' : 'typed'}</span>
          <span>Brain · {health?.brain ?? (offline ? 'offline' : '…')}</span>
        </div>
      </header>
      <div className="start-grid">
        <section>
          <p className="kicker">New session</p>
          <h1 className="display">
            Talk a feature
            <br />
            through.
            <span>Watch it assemble.</span>
          </h1>
          <label className="field">
            <span className="kicker dim">Session title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <p className="kicker dim">Context</p>
          <div className="modes">
            <button type="button" className={`mode press ${mode === 'blank' ? 'on' : ''}`} onClick={() => setMode('blank')}>
              <i />
              <strong>BLANK SLATE</strong>
              <small>Scene tools only. Fast greenfield turns.</small>
            </button>
            <button type="button" className={`mode press ${mode === 'grounded' ? 'on' : ''}`} onClick={() => setMode('grounded')}>
              <i />
              <strong>GROUNDED</strong>
              <small>Reads repos and schemas. Opens in constellation view.</small>
            </button>
          </div>
          <p className="allow">
            <span>Read-only</span> · local shape catalog
          </p>
          <p className="hint">Shape, never contents — no data, log or ticket tools. Live MCP is not connected.</p>
        </section>
        <div className="past">
          <p className="past-label">Past sessions</p>
          <Rings />
          <button type="button" className="hold press" onClick={() => void begin()}>
            Hold
            <small>space</small>
            to begin
          </button>
          {sessions.slice(0, 3).map((session, index) => (
            <button
              key={session.id}
              type="button"
              className="past-node"
              style={PLACES[index]}
              onClick={() => onOpen(session.id)}
            >
              <strong>
                <i className="dot" />
                {session.title}
              </strong>
              <em>
                {formatDay(session.createdAt)} · {versionLabel(session.version)} · {session.blurb}
                {session.sample ? ' · sample' : ''}
              </em>
            </button>
          ))}
        </div>
        <aside className="prompts">
          <p className="kicker dim">You can say</p>
          {PROMPTS.map((prompt) => (
            <figure key={prompt.text}>
              <blockquote>“{prompt.text}”</blockquote>
              <figcaption>{prompt.note}</figcaption>
            </figure>
          ))}
        </aside>
      </div>
      <footer className="bottombar">
        <p className="footer-hint">Hold space · talk · release · send · space while speaking · interrupt</p>
        <button type="button" className="begin press" onClick={() => void begin()} disabled={busy}>
          Begin session →
        </button>
      </footer>
      {error ? <p className="error-line">{error}</p> : null}
      {offline ? <p className="error-line">Local server is not on :8787. Run npm run dev.</p> : null}
    </Frame>
  )
}
