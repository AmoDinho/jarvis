import { describe, expect, it } from 'vitest'
import { buildQuoteScene } from '../shared/quote-flow.ts'
import { logDecision } from '../shared/patch.ts'
import { buildSpec } from '../shared/spec.ts'
import { toMermaid } from '../shared/mermaid.ts'
import { takeSentences } from '../shared/speech.ts'
import { readShape } from '../shared/shape.ts'

describe('spec, speech and shape', () => {
  it('writes the seven-section outline from the scene only', () => {
    let { scene, notes } = buildQuoteScene(7, 'Quote flow v2 — async rating')
    const logged = logDecision(scene, {
      chose: 'Emit QuoteCreated as an event',
      because: 'Policy should not read another domain’s tables',
      affects: ['quote-service', 'policy-service'],
      rejected: ['Policy polls the quote store'],
    })
    expect(logged.ok).toBe(true)
    if (!logged.ok) return
    scene = logged.scene
    const spec = buildSpec({
      scene,
      folder: 'sessions/2026-10-21-quote-flow-v2',
      generatedAt: '2026-10-21T14:10:00.000Z',
      startedAt: '2026-10-21T14:06:00.000Z',
      turns: 8,
      simulations: [],
      evolution: notes,
      files: [{ name: 'spec.md', note: '1 KB' }],
    })
    for (const heading of ['## 1. Summary', '## 2. Architecture', '## 3. Components', '## 4. Flows', '## 5. Decisions', '## 6. Open questions', '## 7. Evolution']) {
      expect(spec.markdown).toContain(heading)
    }
    expect(spec.markdown).toContain('quote-service')
    expect(spec.markdown).toContain('```mermaid')
    expect(spec.mermaid).toContain('quote_service')
    expect(spec.evolution.length).toBeGreaterThan(0)
    expect(spec.evolution.length).toBeLessThanOrEqual(5)
    expect(spec.markdown.toLowerCase()).not.toContain('example value')
  })

  it('mermaid stays in sync with edges', () => {
    const { scene } = buildQuoteScene(4)
    const mermaid = toMermaid(scene)
    expect(mermaid).toContain('rating_partner')
    expect(mermaid).toContain('-->')
  })

  it('splits sentences without eating decimals', () => {
    const { sentences, rest } = takeSentences('Rating sits at 1.8 seconds. The cache holds. And then')
    expect(sentences).toEqual(['Rating sits at 1.8 seconds.', 'The cache holds.'])
    expect(rest.trim()).toBe('And then')
  })

  it('refuses data queries and unknown sources', () => {
    const refused = readShape('repo-search', 'select * from customers where email = secret')
    expect(refused.ok).toBe(false)
    const unknown = readShape('ticket-search', 'quote')
    expect(unknown.ok).toBe(false)
    const ok = readShape('graphql-schema', 'QuoteCreated')
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(JSON.stringify(ok)).not.toMatch(/@|password|555-/)
    expect(ok.types.some((type) => type.name === 'QuoteCreated')).toBe(true)
  })
})
