import type { Health, SessionRecord, SessionSummary } from '@shared/session'
import type { Scenario, Scene } from '@shared/types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const text = await response.text()
  const body = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T)
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${response.status})`)
  return body
}

export const api = {
  health: () => request<Health>('/api/health'),
  sessions: () => request<{ sessions: SessionSummary[] }>('/api/sessions'),
  session: (id: string) => request<{ session: SessionRecord }>(`/api/sessions/${id}`),
  create: (title: string, mode: 'blank' | 'grounded') =>
    request<{ session: SessionRecord }>('/api/sessions', { method: 'POST', body: JSON.stringify({ title, mode }) }),
  turn: (id: string, text: string) =>
    request<{ ok: true }>(`/api/sessions/${id}/turns`, { method: 'POST', body: JSON.stringify({ text }) }),
  interrupt: (id: string) => request<{ ok: true }>(`/api/sessions/${id}/interrupt`, { method: 'POST', body: '{}' }),
  focus: (id: string, componentId: string) =>
    request<{ ok: true }>(`/api/sessions/${id}/focus`, { method: 'POST', body: JSON.stringify({ id: componentId }) }),
  simulate: (id: string, scenario: Scenario) =>
    request<{ ok: true }>(`/api/sessions/${id}/simulate`, { method: 'POST', body: JSON.stringify(scenario) }),
  writeup: (id: string) => request<{ ok: true }>(`/api/sessions/${id}/writeup`, { method: 'POST', body: '{}' }),
  resolve: (id: string, text: string) =>
    request<{ ok: true }>(`/api/sessions/${id}/questions/resolve`, { method: 'POST', body: JSON.stringify({ text }) }),
  reveal: (id: string) => request<{ folder: string }>(`/api/sessions/${id}/reveal`, { method: 'POST', body: '{}' }),
  snapshot: (id: string, version: number) => request<{ scene: Scene }>(`/api/sessions/${id}/scenes/${version}`),
  specText: async (id: string) => {
    const response = await fetch(`/api/sessions/${id}/spec.md`)
    if (!response.ok) throw new Error('Spec is not written yet.')
    return response.text()
  },
  renderHtml: async (id: string, renderId: string) => {
    const response = await fetch(`/api/sessions/${id}/renders/${renderId}`)
    if (!response.ok) throw new Error('Render is not ready.')
    return response.text()
  },
}
