import { useMemo, useState } from 'react'
import type { SessionRecord } from '@shared/session'
import type { Scene } from '@shared/types'
import { formatClock } from '@shared/format'
import { constellationLayout, satelliteLayout } from '@shared/layout'
import { matchFigure } from '@shared/figures'
import { Waveform, groupColor } from '../ui.tsx'
import { LibraryFigure } from '../figures.tsx'

export function Constellation({
  session,
  scene,
  phase,
  speech,
  levels,
  onFocus,
  onSend,
  onTrace,
  onOpenRender,
  onDecisions,
}: {
  session: SessionRecord
  scene: Scene
  phase: string
  speech: string
  levels: number[]
  onFocus: (id: string) => void
  onSend: (text: string) => void
  onTrace: (entry: string) => void
  onOpenRender: (id: string, title: string) => void
  onDecisions: () => void
}) {
  const points = useMemo(() => constellationLayout(scene), [scene])
  const stars = useMemo(() => satelliteLayout(scene), [scene])
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [figure, setFigure] = useState(false)
  const focus = scene.components.find((c) => c.id === scene.focus)
  const groups = [...new Set(scene.components.map((c) => c.group || c.kind))]
  const needle = query.trim().toLowerCase()

  function submit() {
    const matches = scene.components.filter((c) => `${c.id} ${c.label}`.toLowerCase().includes(needle))
    if (matches.length === 1 && matches[0]) onFocus(matches[0].id)
    else if (needle) onSend(query)
    setQuery('')
  }

  return (
    <div className="constellation">
      <svg className="scene" viewBox="-1.1 -1.1 2.2 2.2">
        {(scene.satellites ?? []).map((sat) => {
          const point = stars[sat.id]
          if (!point) return null
          return <circle key={sat.id} cx={point.x} cy={point.y} r="0.008" fill={groupColor(sat.group)} opacity="0.55" />
        })}
        {scene.edges.map((edge) => {
          const a = points[edge.from]
          const b = points[edge.to]
          if (!a || !b) return null
          const from = scene.components.find((c) => c.id === edge.from)
          return (
            <line
              key={edge.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={groupColor(from?.group)}
              strokeWidth="0.004"
              strokeDasharray={edge.style === 'sync' ? undefined : '0.012 0.01'}
              opacity="0.8"
            />
          )
        })}
        {scene.components.map((component) => {
          const point = points[component.id]
          if (!point) return null
          const dim = (group && (component.group || component.kind) !== group) || (needle && !`${component.id} ${component.label}`.toLowerCase().includes(needle))
          return (
            <g key={component.id} opacity={dim ? 0.25 : 1} onClick={() => onFocus(component.id)} style={{ cursor: 'pointer' }}>
              <rect x={point.x - 0.07} y={point.y - 0.018} width="0.14" height="0.036" rx="0.012" fill="#10151d" stroke={groupColor(component.group)} strokeWidth="0.003" />
              <text x={point.x} y={point.y + 0.005} textAnchor="middle" fill="#e8fbff" fontSize="0.016">
                {component.id}
              </text>
            </g>
          )
        })}
      </svg>
      <form
        className="search-row"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a component, or hold Space to talk" aria-label="Find a component" />
        <button type="submit" className="chip press">
          Space
        </button>
      </form>
      <div className="chip-row">
        {groups.map((name) => (
          <button key={name} type="button" className={`chip ${group === name ? 'on' : ''}`} style={{ color: groupColor(name) }} onClick={() => setGroup(group === name ? null : name)}>
            {name} {scene.components.filter((c) => (c.group || c.kind) === name).length}
          </button>
        ))}
      </div>
      {session.mode === 'grounded' ? <p className="kicker" style={{ position: 'absolute', right: 28, top: 64 }}>Grounded · local shape catalog · read-only</p> : null}
      {focus ? (
        <article className="detail">
          <header className="kicker">
            {focus.kind} · {focus.group ?? 'ungrouped'}
            <span className="faint" style={{ float: 'right' }}>{focus.shape?.path}</span>
          </header>
          <h2>{focus.id}</h2>
          <div className="sig">{focus.shape?.signature ?? focus.notes ?? 'No signature stored. Shape only.'}</div>
          <div className="links">
            <div>
              <span className="kicker dim">Used by · {scene.edges.filter((e) => e.to === focus.id).length}</span>
              {scene.edges.filter((e) => e.to === focus.id).map((e) => (
                <div key={e.id}>{e.from}</div>
              ))}
            </div>
            <div>
              <span className="kicker dim">Uses · {scene.edges.filter((e) => e.from === focus.id).length}</span>
              {scene.edges.filter((e) => e.from === focus.id).map((e) => (
                <div key={e.id}>{e.to}</div>
              ))}
            </div>
          </div>
          <div className="detail-actions">
            <button type="button" className="primary press" onClick={() => onTrace(scene.components.find((c) => c.kind === 'client')?.id ?? focus.id)}>
              Trace a request
            </button>
            <button
              type="button"
              className="press"
              onClick={() => {
                const render = session.renders.find((item) => item.componentId === focus.id && item.status !== 'queued')
                if (render) onOpenRender(render.id, render.title)
                else setFigure(true)
              }}
            >
              Open structure{matchFigure(focus) ? ` · ${matchFigure(focus)}` : ''}
            </button>
          </div>
        </article>
      ) : null}
      {figure && focus ? (
        <aside className="render-panel" style={{ left: 400, right: 'auto' }}>
          <header>
            <span>Tier 1 · {focus.label}</span>
            <button type="button" onClick={() => setFigure(false)}>
              Close
            </button>
          </header>
          <LibraryFigure name={`${focus.kind} ${focus.id}`} />
        </aside>
      ) : null}
      {(phase === 'speaking' || phase === 'thinking' || speech) && (
        <aside className="speaking" aria-live="polite">
          <header>
            <span>
              <Waveform active={phase === 'speaking' || phase === 'listening'} levels={levels} /> {phase === 'thinking' ? 'Jarvis thinking' : 'Jarvis speaking'}
            </span>
            <span className="faint">Space to interrupt</span>
          </header>
          <p>{speech || 'Composing the scene.'}</p>
        </aside>
      )}
      <div className="patch-stream">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button type="button" className="kicker" onClick={onDecisions} style={{ background: 'none', border: 0, padding: 0 }}>
            Patch stream · decisions
          </button>
          <span className="faint">
            {scene.components.length} components · {scene.edges.length} edges · {scene.decisions.length} decisions · {session.renders.length} renders
          </span>
        </div>
        <table>
          <tbody>
            {session.activity.slice(0, 6).map((item) => (
              <tr key={item.id}>
                <td>{item.version ? versionSafe(item.version) : '—'}</td>
                <td>{formatClock(item.at)}</td>
                <td>{item.tool}</td>
                <td>{item.action}</td>
                <td className="target">{item.target}</td>
                <td>{item.detail}</td>
                <td>
                  <span className={`pill ${item.status}`}>{item.status.replace('_', ' ')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function versionSafe(version: number): string {
  return `v${String(version).padStart(2, '0')}`
}
