import type { Component } from './types.ts'

export type FigureId = 'queue' | 'cache' | 'store' | 'gateway' | 'retry' | 'service' | 'external' | 'client' | 'function'

const ORDER: { id: FigureId; test: RegExp }[] = [
  { id: 'retry', test: /retry|backoff|dead-letter|dlq/ },
  { id: 'queue', test: /queue/ },
  { id: 'cache', test: /cache/ },
  { id: 'store', test: /store|database|db/ },
  { id: 'gateway', test: /gateway|proxy/ },
  { id: 'external', test: /partner|external|vendor/ },
  { id: 'client', test: /client|web|browser/ },
  { id: 'function', test: /function|worker|lambda/ },
  { id: 'service', test: /service/ },
]

export function matchFigure(component: Component): FigureId | null {
  const hay = `${component.kind} ${component.id} ${component.label} ${component.notes ?? ''}`.toLowerCase()
  for (const figure of ORDER) {
    if (figure.test.test(hay) || figure.id === component.kind) return figure.id
  }
  return null
}
