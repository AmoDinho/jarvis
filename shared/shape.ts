import type { ComponentKind } from './types.ts'

/**
 * Local shape catalog. Stand-in for the allowlisted repo-search and
 * graphql-schema sources when those MCP servers are not connected.
 * Paths, type names and field names only. No example values, no records.
 */

export type ShapeService = {
  id: string
  kind: ComponentKind
  label: string
  group: string
  path: string
  signature: string
  fields: string[]
}

export type SchemaType = {
  name: string
  fields: string[]
}

export const SHAPE_SERVICES: ShapeService[] = [
  {
    id: 'web-client',
    kind: 'client',
    label: 'Web client',
    group: 'edge',
    path: 'apps/web',
    signature: 'QuoteForm',
    fields: ['coverId', 'riskHash'],
  },
  {
    id: 'api-gateway',
    kind: 'gateway',
    label: 'API gateway',
    group: 'edge',
    path: 'apps/edge',
    signature: 'POST /quotes',
    fields: ['authorization', 'body'],
  },
  {
    id: 'quote-service',
    kind: 'service',
    label: 'Quote service',
    group: 'quoting',
    path: 'apps/quote-service',
    signature: 'createQuote(input: QuoteInput): Quote',
    fields: ['quoteId', 'riskHash', 'status'],
  },
  {
    id: 'quote-store',
    kind: 'store',
    label: 'Quote store',
    group: 'quoting',
    path: 'apps/quote-service/src/store.ts',
    signature: 'quotes',
    fields: ['quoteId', 'riskHash', 'status'],
  },
  {
    id: 'rating-service',
    kind: 'service',
    label: 'Rating service',
    group: 'quoting',
    path: 'apps/rating-service',
    signature: 'price(input: RiskHash): Premium',
    fields: ['riskHash', 'premium'],
  },
  {
    id: 'pricing-cache',
    kind: 'cache',
    label: 'Pricing cache',
    group: 'quoting',
    path: 'apps/rating-service/src/price-cache.ts',
    signature: 'get(key: RiskHash): Premium | miss',
    fields: ['riskHash'],
  },
  {
    id: 'rating-partner',
    kind: 'external',
    label: 'Rating partner',
    group: 'external',
    path: 'integrations/rating-partner',
    signature: 'Rate(request: PartnerRisk): PartnerPremium',
    fields: ['riskHash'],
  },
  {
    id: 'quote-events',
    kind: 'queue',
    label: 'Quote events',
    group: 'quoting',
    path: 'contracts/events/quote-created.ts',
    signature: 'QuoteCreated { quoteId, riskHash }',
    fields: ['quoteId', 'riskHash'],
  },
  {
    id: 'policy-service',
    kind: 'service',
    label: 'Policy service',
    group: 'policy',
    path: 'apps/policy-service',
    signature: 'bind(quoteId: QuoteId): Policy',
    fields: ['policyId', 'quoteId', 'status'],
  },
  {
    id: 'retry-worker',
    kind: 'function',
    label: 'Retry worker',
    group: 'quoting',
    path: 'apps/quote-service/src/retry-worker.ts',
    signature: 'backoff(attempt): Duration',
    fields: ['attempt', 'quoteId'],
  },
]

export const SCHEMA_TYPES: SchemaType[] = [
  { name: 'Quote', fields: ['id', 'riskHash', 'status', 'premium'] },
  { name: 'QuoteInput', fields: ['riskHash', 'coverId'] },
  { name: 'QuoteCreated', fields: ['quoteId', 'riskHash'] },
  { name: 'Policy', fields: ['id', 'quoteId', 'status'] },
  { name: 'Premium', fields: ['amount', 'currency'] },
]

export const GROUNDED_ALLOWLIST = ['repo-search', 'graphql-schema'] as const

const REFUSED = /\b(select\s+\*|customer|email|password|ssn|log|ticket|pii|production data|phone)\b/i

export type ShapeQueryResult =
  | { ok: true; source: string; note: string; services: ShapeService[]; types: SchemaType[] }
  | { ok: false; message: string }

export function readShape(source: string, query: string): ShapeQueryResult {
  if (!GROUNDED_ALLOWLIST.includes(source as (typeof GROUNDED_ALLOWLIST)[number])) {
    return { ok: false, message: `${source} is not on the grounded allowlist.` }
  }
  if (REFUSED.test(query)) {
    return {
      ok: false,
      message: 'Grounded mode reads code structure and schemas only. It will not fetch records, logs, tickets or example values.',
    }
  }
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2)
  const services = SHAPE_SERVICES.filter((service) => {
    if (!tokens.length) return true
    const hay = `${service.id} ${service.label} ${service.path} ${service.signature} ${service.fields.join(' ')}`.toLowerCase()
    return tokens.some((token) => hay.includes(token))
  })
  const types = SCHEMA_TYPES.filter((type) => {
    if (source === 'repo-search') return false
    if (!tokens.length) return true
    const hay = `${type.name} ${type.fields.join(' ')}`.toLowerCase()
    return tokens.some((token) => hay.includes(token))
  })
  return {
    ok: true,
    source,
    note: 'Local shape catalog. Field names and paths only. No live data.',
    services: services.slice(0, 12),
    types: types.slice(0, 12),
  }
}
