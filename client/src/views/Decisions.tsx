import type { SessionRecord } from '@shared/session'
import { formatClock, versionLabel } from '@shared/format'
import { Frame, Logo, MiniOrbital } from '../ui.tsx'

export function Decisions({
  session,
  onBack,
  onWrite,
  onResolve,
  onPreview,
}: {
  session: SessionRecord
  onBack: () => void
  onWrite: () => void
  onResolve: (text: string) => void
  onPreview: (version: number) => void
}) {
  const notes = session.versionNotes.length
    ? session.versionNotes
    : [{ version: session.scene.version, why: 'Current scene' }]
  return (
    <Frame className="decisions">
      <header className="topbar">
        <Logo onClick={onBack} />
        <p className="kicker dim">
          {session.title} · decisions & evolution
        </p>
        <button type="button" className="begin press" onClick={onBack}>
          ← Back to scene
        </button>
      </header>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '18px 36px 0' }}>
        <p className="kicker">Evolution · {notes.length} versions</p>
        <span className="faint">Key snapshot · goes in the spec</span>
      </div>
      <div className="evo">
        {notes.map((note) => (
          <button key={note.version} type="button" className={note.version === session.scene.version ? 'on' : ''} onClick={() => onPreview(note.version)}>
            <MiniOrbital scene={session.scene} hot={note.version === session.scene.version} />
            <strong>{versionLabel(note.version)}</strong>
            <div>{note.why}</div>
          </button>
        ))}
      </div>
      <div className="decision-layout">
        <section>
          <p className="kicker">Decision log · newest first</p>
          {session.scene.decisions.length === 0 ? <p className="muted">No decisions yet. Make a choice out loud and I will log it.</p> : null}
          {session.scene.decisions.map((decision) => (
            <article key={decision.id} className="decision">
              <time className="faint">{formatClock(decision.at)}</time>
              <div>
                <h3>{decision.chose}</h3>
                <p>{decision.rejected?.[0] ? `${decision.rejected[0]} — ` : ''}{decision.because}</p>
              </div>
              <div className="tags">
                {decision.affects.map((id) => (
                  <span key={id} className="tag">
                    {id}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </section>
        <aside>
          <p className="kicker">Open questions · {session.scene.openQuestions.length}</p>
          {session.scene.openQuestions.map((question) => (
            <label key={question}>
              <input type="checkbox" onChange={() => onResolve(question)} />
              <span>{question}</span>
            </label>
          ))}
          <div className="stat-row">
            <div>
              <strong>{session.scene.decisions.length}</strong>
              <span>Decisions</span>
            </div>
            <div>
              <strong>{session.simulations.length}</strong>
              <span>Simulations</span>
            </div>
            <div>
              <strong>{session.renders.filter((r) => r.status === 'kept' || r.tier === 3).length}</strong>
              <span>Renders kept</span>
            </div>
          </div>
          <button type="button" className="begin press" onClick={onWrite}>
            Write it up →
          </button>
        </aside>
      </div>
    </Frame>
  )
}
