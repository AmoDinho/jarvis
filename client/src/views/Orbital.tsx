import { useEffect, useMemo, useRef } from 'react'
import type { SessionRecord } from '@shared/session'
import type { Scene, SimResult } from '@shared/types'
import { formatClock, formatMs, versionLabel } from '@shared/format'
import { heatColor, orbitalLayout } from '@shared/layout'
import { matchFigure } from '@shared/figures'
import { reducedMotion } from '../voice.ts'
import { Waveform } from '../ui.tsx'

export function Orbital({
  session,
  scene,
  previewing,
  sim,
  phase,
  interim,
  levels,
  onFocus,
  onSend,
  onPreview,
  onClearPreview,
  onOpenRender,
  onDecisions,
  speech,
}: {
  session: SessionRecord
  scene: Scene
  previewing: boolean
  sim: SimResult | null
  phase: string
  interim: string
  levels: number[]
  onFocus: (id: string) => void
  onSend: (text: string) => void
  onPreview: (version: number) => void
  onClearPreview: () => void
  onOpenRender: (id: string, title: string) => void
  onDecisions: () => void
  speech: string
}) {
  const points = useMemo(() => orbitalLayout(scene), [scene])
  const focus = scene.components.find((c) => c.id === scene.focus) ?? scene.components[0]
  const packet = useRef<SVGCircleElement>(null)
  const versions = Math.max(scene.version, session.scene.version)

  useEffect(() => {
    const node = packet.current
    if (!node || sim?.mode !== 'flow') return
    const hops = sim.hops.filter((hop) => hop.critical)
    if (hops.length < 2) return
    let frame = 0
    const started = performance.now()
    const duration = reducedMotion() ? 1 : 4200
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      const index = Math.min(hops.length - 2, Math.floor(t * (hops.length - 1)))
      const local = t * (hops.length - 1) - index
      const a = points[hops[index]!.id]
      const b = points[hops[index + 1]!.id]
      if (a && b) {
        node.setAttribute('cx', String(500 + (a.x + (b.x - a.x) * local) * 390))
        node.setAttribute('cy', String(500 + (a.y + (b.y - a.y) * local) * 390))
      }
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [sim, points])

  const util = focus && sim?.samples.at(-1)?.util[focus.id]
  const displayUtil = util === undefined ? null : Math.min(1, util)
  const lastUser = [...session.turns].reverse().find((turn) => turn.role === 'user')

  return (
    <div className="orbital">
      <svg className="scene" viewBox="0 0 1000 1000">
        {[140, 250, 360, 460].map((r) => (
          <circle key={r} cx="500" cy="500" r={r} fill="none" stroke="rgba(80,140,154,0.35)" />
        ))}
        <line x1="500" y1="40" x2="500" y2="960" stroke="rgba(120,160,170,0.08)" />
        <line x1="40" y1="500" x2="960" y2="500" stroke="rgba(120,160,170,0.08)" />
        {scene.edges.map((edge) => {
          const a = points[edge.from]
          const b = points[edge.to]
          if (!a || !b) return null
          const async = edge.style !== 'sync'
          return (
            <line
              key={edge.id}
              x1={500 + a.x * 390}
              y1={500 + a.y * 390}
              x2={500 + b.x * 390}
              y2={500 + b.y * 390}
              stroke={edge.style === 'event' ? '#7ec8ff' : '#3ee0ff'}
              strokeOpacity={async ? 0.55 : 0.85}
              strokeDasharray={async ? '5 6' : undefined}
            />
          )
        })}
        {scene.components.map((component) => {
          const point = points[component.id]
          if (!point || component.id === focus?.id) return null
          return (
            <g key={component.id} className="node-hit" onClick={() => onFocus(component.id)}>
              <circle cx={500 + point.x * 390} cy={500 + point.y * 390} r="5" fill="#071016" stroke="#3ee0ff" />
            </g>
          )
        })}
        {focus ? (
          <g>
            <circle cx="500" cy="500" r="78" fill="none" stroke="rgba(62,224,255,0.35)" />
            {Array.from({ length: 48 }, (_, i) => {
              const angle = (i / 48) * Math.PI * 2
              const len = 10 + ((i * 17) % 18)
              return (
                <line
                  key={i}
                  x1={500 + Math.cos(angle) * 86}
                  y1={500 + Math.sin(angle) * 86}
                  x2={500 + Math.cos(angle) * (86 + len)}
                  y2={500 + Math.sin(angle) * (86 + len)}
                  stroke="#3ee0ff"
                  strokeOpacity={0.35 + (i % 5) * 0.1}
                />
              )
            })}
            <circle cx="500" cy="500" r="7" fill="#e8fbff" />
            <text x="500" y="492" textAnchor="middle" fill="#7d8f9a" fontSize="11" letterSpacing="3">
              FOCUS
            </text>
            <text x="500" y="514" textAnchor="middle" fill="#f4f7f8" fontSize="16" letterSpacing="1.5">
              {focus.label.toUpperCase()}
            </text>
          </g>
        ) : null}
        <circle ref={packet} cx="500" cy="500" r={sim?.mode === 'flow' ? 6 : 0} fill="#e8fbff" />
      </svg>
      {scene.components.map((component) => {
        const point = points[component.id]
        if (!point || component.id === focus?.id) return null
        const left = point.x < -0.05
        return (
          <button
            key={component.id}
            type="button"
            className={`node-label ${left ? 'left' : ''} ${scene.focus === component.id ? 'on' : ''}`}
            style={{ left: `${50 + point.x * 39}%`, top: `${50 + point.y * 39}%` }}
            onClick={() => onFocus(component.id)}
          >
            <strong>{component.label.toUpperCase()}</strong>
            <em>
              {component.kind} · {formatMs(component.behaviour.latencyMs)}
            </em>
          </button>
        )
      })}
      <div className="rail left">
        {Array.from({ length: versions }, (_, i) => versions - i).map((version) => (
          <button key={version} type="button" className={version === scene.version ? 'on' : ''} onClick={() => onPreview(version)}>
            {versionLabel(version)}
          </button>
        ))}
      </div>
      {focus ? (
        <aside className="telemetry">
          <div className="meter">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <circle cx="32" cy="32" r="26" fill="none" stroke="#16323a" strokeWidth="3" />
              <circle
                cx="32"
                cy="32"
                r="26"
                fill="none"
                stroke={displayUtil === null ? '#3ee0ff' : heatColor(displayUtil)}
                strokeWidth="3"
                strokeDasharray={`${(displayUtil ?? 0.08) * 163} 163`}
                strokeLinecap="round"
                transform="rotate(-90 32 32)"
              />
              <text x="32" y="37" textAnchor="middle" fill="#f4f7f8" fontSize="16">
                {displayUtil === null ? '—' : Math.round(displayUtil * 100)}
              </text>
            </svg>
            <div>
              <span className="kicker dim">Utilisation %</span>
              <strong>{displayUtil === null ? 'idle' : `${Math.round((sim?.summary.offeredRps ?? 0) * Math.min(1, util ?? 0))} / ${Math.round(focus.behaviour.capacityRps)} rps`}</strong>
            </div>
          </div>
          <div className="stats">
            <div>
              <span>P50</span>
              <b>
                {focus.behaviour.latencyMs}
                <small>ms</small>
              </b>
            </div>
            <div>
              <span>Concurrency</span>
              <b>{focus.behaviour.concurrency ?? '—'}</b>
            </div>
            <div>
              <span>Retry</span>
              <b>
                {focus.behaviour.retry ? (
                  <>
                    {focus.behaviour.retry.attempts}
                    <small>×{focus.behaviour.retry.backoffMs}ms</small>
                  </>
                ) : (
                  '—'
                )}
              </b>
            </div>
            <div>
              <span>Edges</span>
              <b>{scene.edges.filter((e) => e.from === focus.id || e.to === focus.id).length}</b>
            </div>
          </div>
          <p className="kicker dim" style={{ marginTop: 16 }}>
            Failure modes
          </p>
          <p>{focus.behaviour.failureModes.join(' · ') || 'none'}</p>
          {matchFigure(focus) ? <p className="faint">Library figure · {matchFigure(focus)}</p> : null}
        </aside>
      ) : null}
      <div className="mini-log">
        <button type="button" className="kicker" onClick={onDecisions} style={{ background: 'none', border: 0, padding: 0 }}>
          Decision log
        </button>
        <ul>
          {session.scene.decisions.slice(0, 3).map((decision) => (
            <li key={decision.id}>
              <time>{formatClock(decision.at)}</time>
              {decision.chose}
            </li>
          ))}
        </ul>
      </div>
      <div className="utter-bar">
        {phase === 'listening' ? (
          <div className="listen-flag">
            <i /> Listening · hold space
          </div>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            onSend(String(data.get('q') ?? ''))
            event.currentTarget.reset()
          }}
        >
          <input
            className="utterance"
            name="q"
            aria-label="Talk or type"
            placeholder={phase === 'listening' ? interim || 'Listening' : lastUser?.text || 'Hold Space to talk'}
            defaultValue={phase === 'listening' ? interim : ''}
            key={phase === 'listening' ? 'listen' : lastUser?.id ?? 'idle'}
          />
        </form>
        {phase === 'listening' ? <Waveform active levels={levels} /> : null}
        {phase !== 'listening' && speech ? <p className="reply-line">{speech}</p> : null}
      </div>
      <div className="badges">
        {session.renders.slice(0, 2).map((render) => (
          <button
            key={render.id}
            type="button"
            className={`badge press ${render.status === 'queued' ? 'queued' : ''}`}
            onClick={() => render.status !== 'queued' && onOpenRender(render.id, render.title)}
          >
            T{render.tier}
            <small>{render.status === 'queued' ? 'queued' : render.status}</small>
          </button>
        ))}
      </div>
      {previewing ? (
        <div className="preview-banner">
          Viewing {versionLabel(scene.version)} ·{' '}
          <button type="button" onClick={onClearPreview}>
            return to live
          </button>
        </div>
      ) : null}
    </div>
  )
}
