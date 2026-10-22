import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { SessionRecord } from '@shared/session'
import type { Scene, SimResult, ViewName } from '@shared/types'
import { heatColor, isoLayout } from '@shared/layout'
import { formatMs } from '@shared/format'
import { Waveform } from '../ui.tsx'
import { reducedMotion } from '../voice.ts'

const WarRoomScene = lazy(() => import('./WarRoomScene.tsx'))

export function WarRoom({
  session,
  scene,
  sim,
  narration,
  phase,
  levels,
  onFocus,
  onView,
  flat,
}: {
  session: SessionRecord
  scene: Scene
  sim: SimResult | null
  narration: string[]
  phase: string
  levels: number[]
  onFocus: (id: string) => void
  onView: (view: ViewName) => void
  onTalk: () => void
  flat: boolean
}) {
  const [mode, setMode] = useState<SimResult['mode']>(sim?.mode ?? 'load')
  const [t, setT] = useState(sim?.samples.at(-1)?.t ?? 0)
  const [playing, setPlaying] = useState(false)
  const duration = sim?.scenario.durationS ?? sim?.samples.length ?? 30
  const sample = sim?.samples.find((item) => item.t === Math.round(t)) ?? sim?.samples.at(-1)
  const stepIndex = Math.min((sim?.steps.length ?? 1) - 1, Math.max(0, Math.round(t)))

  useEffect(() => {
    if (!sim) return
    setMode(sim.mode)
    if (reducedMotion()) {
      setT(sim.samples.at(-1)?.t ?? sim.steps.length - 1)
      return
    }
    setT(0)
    setPlaying(true)
  }, [sim])

  useEffect(() => {
    if (!playing || !sim) return
    const end = sim.mode === 'step' ? Math.max(0, sim.steps.length - 1) : duration
    const timer = window.setInterval(() => {
      setT((current) => {
        if (current >= end) {
          setPlaying(false)
          return end
        }
        return current + (sim.mode === 'step' ? 1 : 0.2)
      })
    }, sim.mode === 'step' ? 700 : 80)
    return () => window.clearInterval(timer)
  }, [playing, sim, duration])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT') return
      setPlaying(false)
      setT((current) => Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ranked = [...scene.components].sort((a, b) => (sample?.util[b.id] ?? 0) - (sample?.util[a.id] ?? 0))
  const prompt = sim?.scenario.prompt ?? 'Run a load, a trace, or a step-through.'

  return (
    <div className="war" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="war-top">
        <span>Illustrative — not capacity planning</span>
        <span>Jarvis // war room</span>
        <span>{sim ? `sim-${sim.mode}-${session.shortId}` : 'no sim'}</span>
        <span>Entry {sim?.entry ?? '—'}</span>
        <span>
          {sim?.scenario.rps ?? '—'} rps · {duration}s
        </span>
        <span>{sim?.scenario.faults?.[0] ? `Fault ${sim.scenario.faults[0].component} ${sim.scenario.faults[0].mode}` : 'No fault'}</span>
        <span>Scene {String(scene.version).padStart(2, '0')}</span>
      </div>
      <div className="war-title">
        <h1>{mode === 'flow' ? 'FLOW' : mode === 'step' ? 'STEP' : 'LOAD'}</h1>
        <div>
          <div className="kicker dim">{session.title}</div>
          <p>{prompt}</p>
        </div>
        <div className="mode-tabs">
          {(['flow', 'load', 'step'] as const).map((item) => (
            <button key={item} type="button" className={mode === item ? 'on' : ''} onClick={() => setMode(item)}>
              {item === 'load' ? 'Failure + load' : item}
            </button>
          ))}
        </div>
        <div className="clock">
          {mode === 'step' ? stepIndex + 1 : t.toFixed(1)}
          <small>/{mode === 'step' ? sim?.steps.length ?? 0 : duration}s</small>
        </div>
      </div>
      <div className="war-body">
        <section className="panel">
          <h2>Pressure map</h2>
          {ranked.slice(0, 8).map((component) => {
            const util = Math.min(1, sample?.util[component.id] ?? 0)
            return (
              <div className="bar-row" key={component.id}>
                <span>{component.id}</span>
                <div className="bar">
                  <span style={{ width: `${util * 100}%`, background: heatColor(util) }} />
                </div>
                <span>{Math.round(util * 100)}%</span>
              </div>
            )
          })}
          <svg className="spark" viewBox="0 0 240 42" aria-hidden="true">
            <polyline
              fill="none"
              stroke="#ff5b45"
              strokeWidth="1.5"
              points={(sim?.samples ?? []).map((item, i) => `${(i / Math.max(1, (sim?.samples.length ?? 1) - 1)) * 240},${40 - Math.min(38, item.retries / 20)}`).join(' ')}
            />
          </svg>
          <span className="faint">Retries · illustrative</span>
        </section>
        <div style={{ minHeight: 0 }}>
          <WebglBoundary fallback={<IsoFallback scene={scene} sample={sample} onFocus={onFocus} />}>
            <Suspense fallback={<IsoFallback scene={scene} sample={sample} onFocus={onFocus} />}>
              <WarRoomScene scene={scene} sample={sample} flat={flat} focus={scene.focus} onFocus={onFocus} />
            </Suspense>
          </WebglBoundary>
        </div>
        <aside>
          <div className="metric bad">
            <span className="kicker">End-to-end p50</span>
            <b>{sim ? formatMs(sim.summary.e2eP50Ms) : '—'}</b>
            <span className="faint">Baseline {sim ? formatMs(sim.summary.baselineMs) : '—'}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="metric">
              <span className="kicker">Throughput</span>
              <b>{sim ? Math.round(sim.summary.throughputRps) : '—'}</b>
              <span className="faint">of {sim?.summary.offeredRps ?? '—'} rps</span>
            </div>
            <div className="metric bad">
              <span className="kicker">Failed</span>
              <b>{sim ? `${sim.summary.failedPct.toFixed(1)}%` : '—'}</b>
            </div>
          </div>
          <div className="metric">
            <span className="kicker">Queue depth</span>
            <b>{sim ? sim.summary.queueDepth.toLocaleString() : '—'}</b>
            <span className="faint">{sim?.summary.queueComponent ?? 'holding'}</span>
          </div>
          <div className="metric ok">
            <span className="kicker">Cache hit</span>
            <b>{sim?.summary.cacheHitPct !== undefined ? `${sim.summary.cacheHitPct}%` : '—'}</b>
            <span className="faint">illustrative</span>
          </div>
          <div className="break">
            <span className="kicker">First to break</span>
            <strong>{sim?.summary.firstBreak?.component ?? sim?.summary.bottleneck ?? '—'}</strong>
            <p>{sim?.summary.firstBreak?.reason ?? 'Run a load to see where pressure goes.'}</p>
          </div>
          {mode === 'step' && sim?.steps[stepIndex] ? (
            <p>
              {sim.steps[stepIndex]?.label} — {sim.steps[stepIndex]?.detail}
            </p>
          ) : null}
        </aside>
      </div>
      <div className="narration">
        <Waveform active={phase === 'speaking'} levels={levels} />
        <div>
          <div className="kicker">Jarvis · narrating result</div>
          <p>{narration.join(' ') || 'Numbers are illustrative. They show where pressure goes, not a capacity plan.'}</p>
        </div>
        <button type="button" className="begin press" style={{ marginLeft: 'auto' }}>
          Hold space
        </button>
      </div>
      <div className="scrub">
        <input
          type="range"
          min={0}
          max={mode === 'step' ? Math.max(0, (sim?.steps.length ?? 1) - 1) : duration}
          step={mode === 'step' ? 1 : 0.1}
          value={Math.min(t, mode === 'step' ? (sim?.steps.length ?? 1) - 1 : duration)}
          aria-label="Simulation time"
          onChange={(event) => {
            setPlaying(false)
            setT(Number(event.target.value))
          }}
        />
        <div className="scrub-events">
          {(sim?.summary.events ?? []).map((event) => (
            <span key={event.label}>{event.label}</span>
          ))}
        </div>
      </div>
      <div className="war-bottom">
        <span>← → step · space talk · F flat mode</span>
        <span>
          {(['orbital', 'constellation', 'warroom'] as const).map((view) => (
            <button key={view} type="button" className={view === 'warroom' ? 'on' : ''} onClick={() => onView(view)} style={{ marginLeft: 12, background: view === 'warroom' ? '#ffb020' : 'transparent', color: view === 'warroom' ? '#1a1004' : 'inherit', border: 0, padding: '6px 10px' }}>
              {view}
            </button>
          ))}
        </span>
        <span>Numbers are illustrative</span>
      </div>
    </div>
  )
}

function IsoFallback({
  scene,
  sample,
  onFocus,
}: {
  scene: Scene
  sample: SimResult['samples'][number] | undefined
  onFocus: (id: string) => void
}) {
  const points = isoLayout(scene)
  return (
    <svg viewBox="-8 -2 16 14" style={{ width: '100%', height: '100%' }}>
      <polygon points="-6,6 0,9 6,6 0,3" fill="none" stroke="rgba(255,176,32,0.35)" />
      {scene.components.map((component) => {
        const point = points[component.id]
        if (!point) return null
        const x = (point.gx - point.gy) * 1.1
        const y = (point.gx + point.gy) * 0.55
        const util = Math.min(1, sample?.util[component.id] ?? 0)
        return (
          <g key={component.id} onClick={() => onFocus(component.id)} style={{ cursor: 'pointer' }}>
            <polygon points={`${x},${y} ${x + 0.7},${y + 0.35} ${x},${y + 0.7} ${x - 0.7},${y + 0.35}`} fill={heatColor(util)} opacity="0.85" />
            <text x={x} y={y - 0.15} textAnchor="middle" fill="#f6efe4" fontSize="0.28">
              {component.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

class WebglBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
