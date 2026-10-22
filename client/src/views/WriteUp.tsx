import { useState } from 'react'
import type { SessionRecord } from '@shared/session'
import { formatDay } from '@shared/format'
import { api } from '../api.ts'
import { Frame, Logo, MiniOrbital, Waveform } from '../ui.tsx'

const SECTIONS = ['Summary', 'Architecture', 'Components', 'Flows', 'Decisions', 'Open questions', 'Evolution']

export function WriteUp({ session, onDecisions }: { session: SessionRecord; onDecisions: () => void }) {
  const spec = session.spec
  const [section, setSection] = useState(0)
  const [copied, setCopied] = useState(false)
  if (!spec) return null

  async function copy() {
    const text = await api.specText(session.id)
    await navigator.clipboard.writeText(text)
    setCopied(true)
  }

  return (
    <Frame className="writeup">
      <header className="topbar">
        <Logo onClick={onDecisions} />
        <p className="kicker dim">Write-up · generated from scene {String(session.scene.version).padStart(2, '0')}</p>
        <button type="button" className="begin press" onClick={onDecisions}>
          ← Decisions
        </button>
      </header>
      <div className="write-grid">
        <nav className="outline">
          <p className="kicker">Outline</p>
          {SECTIONS.map((name, index) => (
            <button key={name} type="button" className={section === index ? 'on' : ''} onClick={() => setSection(index)}>
              {String(index + 1).padStart(2, '0')} {name}
            </button>
          ))}
        </nav>
        <article className="article">
          <h1>{spec.title}</h1>
          <p className="faint">
            {formatDay(spec.generatedAt)} · {spec.minutes} min · {spec.turns} turns · {session.scene.components.length} components · {session.scene.decisions.length} decisions
          </p>
          {section === 0 ? (
            <>
              <h2>01 · Summary</h2>
              <p className="lead">{spec.summary}</p>
            </>
          ) : null}
          {section === 1 ? (
            <>
              <h2>02 · Architecture</h2>
              <div className="arch">
                <div className="shot">
                  <MiniOrbital scene={session.scene} hot />
                  <p className="faint">hud-final.svg</p>
                </div>
                <pre>{spec.mermaid}</pre>
              </div>
            </>
          ) : null}
          {section === 2 ? (
            <>
              <h2>03 · Components</h2>
              <table>
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Responsibility</th>
                    <th>P50</th>
                    <th>Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.components.map((component) => (
                    <tr key={component.id}>
                      <td>{component.id}</td>
                      <td>{component.responsibility}</td>
                      <td>{component.p50}</td>
                      <td>{component.capacity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {section === 3 ? (
            <>
              <h2>04 · Flows</h2>
              {spec.flows.length === 0 ? <p>No simulations yet.</p> : null}
              {spec.flows.map((flow) => (
                <p key={flow.title}>
                  <strong>{flow.title}.</strong> {flow.detail}
                </p>
              ))}
            </>
          ) : null}
          {section === 4 ? (
            <>
              <h2>05 · Decisions</h2>
              {spec.decisions.map((decision) => (
                <p key={decision.chose}>
                  <strong>{decision.chose}.</strong> {decision.because}
                </p>
              ))}
            </>
          ) : null}
          {section === 5 ? (
            <>
              <h2>06 · Open questions</h2>
              {spec.questions.length === 0 ? <p>None.</p> : null}
              <ul>
                {spec.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </>
          ) : null}
          {section === 6 ? (
            <>
              <h2>07 · Evolution</h2>
              {spec.evolution.map((snap) => (
                <p key={snap.version}>
                  <strong>v{String(snap.version).padStart(2, '0')}.</strong> {snap.why}
                </p>
              ))}
            </>
          ) : null}
        </article>
        <aside className="files">
          <div className="written">
            <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
              <circle cx="27" cy="27" r="24" fill="none" stroke="#3ee0ff" />
              <path d="M16 28l7 7 15-16" fill="none" stroke="#3ee0ff" strokeWidth="1.6" />
            </svg>
            <div>
              <strong>SPEC WRITTEN</strong>
              <div className="faint">{spec.folder}/</div>
            </div>
          </div>
          {spec.files.map((file) => (
            <div key={file.name} className="faint" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(150,196,206,0.16)' }}>
              <span>{file.name}</span>
              <span>{file.note}</span>
            </div>
          ))}
          <button type="button" className="press" onClick={() => void api.reveal(session.id)}>
            Open folder →
          </button>
          <button type="button" className="press" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy markdown'} <span>⌘C</span>
          </button>
          <button type="button" className="later" disabled>
            Push to Confluence <span>Later</span>
          </button>
          <p className="hint">Only what the scene model holds is written. Nothing fetched raw from a repo is persisted.</p>
        </aside>
      </div>
      <footer className="bottombar">
        <p>
          <Waveform active /> <span className="kicker">Speaking</span> Written up — seven sections and {spec.evolution.length} key snapshots.
        </p>
      </footer>
    </Frame>
  )
}
