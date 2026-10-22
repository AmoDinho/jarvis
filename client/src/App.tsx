import { useEffect, useState } from 'react'
import type { Health, SessionSummary } from '@shared/session'
import { api } from './api.ts'
import { StartScreen } from './views/StartScreen.tsx'
import { SessionScreen } from './views/SessionScreen.tsx'

function hashId(): string | null {
  const match = location.hash.match(/^#\/session\/([a-z0-9-]+)/)
  return match?.[1] ?? null
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [offline, setOffline] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(hashId)
  const [autostart, setAutostart] = useState<string | null>(null)
  const [flat, setFlat] = useState(() => localStorage.getItem('jarvis-flat') === '1')

  useEffect(() => {
    document.documentElement.classList.toggle('flat', flat)
    localStorage.setItem('jarvis-flat', flat ? '1' : '0')
  }, [flat])

  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const [nextHealth, list] = await Promise.all([api.health(), api.sessions()])
        if (stop) return
        setHealth(nextHealth)
        setSessions(list.sessions)
        setOffline(false)
      } catch {
        if (!stop) setOffline(true)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 8000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [sessionId])

  useEffect(() => {
    const onHash = () => setSessionId(hashId())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function open(id: string) {
    location.hash = `#/session/${id}`
    setSessionId(id)
  }

  function close() {
    location.hash = ''
    setSessionId(null)
    setAutostart(null)
  }

  return sessionId ? (
    <SessionScreen
      id={sessionId}
      health={health}
      flat={flat}
      setFlat={setFlat}
      onBack={close}
      autostart={autostart}
      clearAutostart={() => setAutostart(null)}
    />
  ) : (
    <StartScreen
      health={health}
      offline={offline}
      sessions={sessions}
      onOpen={open}
      onAutostart={setAutostart}
    />
  )
}
