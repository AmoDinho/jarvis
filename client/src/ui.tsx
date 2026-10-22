import type { ReactNode } from 'react'
import type { Scene } from '@shared/types'
import { orbitalLayout } from '@shared/layout'

export function Frame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`frame ${className}`}>
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />
      {children}
    </div>
  )
}

export function Logo({ subtitle, onClick }: { subtitle?: string; onClick?: () => void }) {
  return (
    <button className="logo" type="button" onClick={onClick}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="8.5" fill="none" stroke="#3ee0ff" strokeWidth="1" />
        <circle cx="11" cy="11" r="2" fill="#3ee0ff" />
        <path d="M11 1.5v3M11 17.5v3M1.5 11h3M17.5 11h3" stroke="#3ee0ff" strokeWidth="1" />
      </svg>
      JARVIS
      {subtitle ? <small>{subtitle}</small> : null}
    </button>
  )
}

export function Rings() {
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2
    const inner = 348
    const outer = 364
    return (
      <line
        key={i}
        className="tick"
        x1={400 + Math.cos(angle) * inner}
        y1={400 + Math.sin(angle) * inner}
        x2={400 + Math.cos(angle) * outer}
        y2={400 + Math.sin(angle) * outer}
      />
    )
  })
  return (
    <svg className="rings" viewBox="0 0 800 800" aria-hidden="true">
      {[110, 190, 270, 340].map((r) => (
        <circle key={r} cx="400" cy="400" r={r} />
      ))}
      {ticks}
      <line x1="400" y1="46" x2="400" y2="70" className="tick" />
      <line x1="400" y1="730" x2="400" y2="754" className="tick" />
    </svg>
  )
}

export function Waveform({ active, levels = [] }: { active: boolean; levels?: number[] }) {
  return (
    <span className={`wave ${active ? 'on' : ''}`} aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => (
        <i key={i} style={levels[i] ? { transform: `scaleY(${0.25 + levels[i]! * 0.75})` } : undefined} />
      ))}
    </span>
  )
}

export function MiniOrbital({ scene, hot = false }: { scene: Scene; hot?: boolean }) {
  const points = orbitalLayout(scene)
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="18" fill="none" stroke={hot ? '#3ee0ff' : '#24515c'} />
      <circle cx="50" cy="50" r="34" fill="none" stroke={hot ? '#1d4d58' : '#1a3038'} />
      {scene.edges.map((edge) => {
        const a = points[edge.from]
        const b = points[edge.to]
        if (!a || !b) return null
        return (
          <line
            key={edge.id}
            x1={50 + a.x * 36}
            y1={50 + a.y * 36}
            x2={50 + b.x * 36}
            y2={50 + b.y * 36}
            stroke="#3ee0ff"
            strokeOpacity="0.7"
          />
        )
      })}
      {scene.components.map((component) => {
        const point = points[component.id]
        if (!point) return null
        const focused = scene.focus === component.id
        return <circle key={component.id} cx={50 + point.x * 36} cy={50 + point.y * 36} r={focused ? 2.4 : 1.3} fill={hot || focused ? '#e8fbff' : '#7d97a0'} />
      })}
    </svg>
  )
}

export function groupColor(group?: string): string {
  if (group === 'release') return '#b07cff'
  if (group === 'edge') return '#ffb020'
  if (group === 'external') return '#ff7a9a'
  if (group === 'reviews') return '#5ce1ff'
  return '#3ee0ff'
}
