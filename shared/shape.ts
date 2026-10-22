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
    signature: 'PublishForm',
    fields: ['repoId', 'sourceHash'],
  },
  {
    id: 'api-gateway',
    kind: 'gateway',
    label: 'API gateway',
    group: 'edge',
    path: 'apps/edge',
    signature: 'POST /builds',
    fields: ['authorization', 'body'],
  },
  {
    id: 'build-service',
    kind: 'service',
    label: 'Build service',
    group: 'builds',
    path: 'apps/build-service',
    signature: 'createBuild(input: BuildInput): Build',
    fields: ['buildId', 'sourceHash', 'status'],
  },
  {
    id: 'build-store',
    kind: 'store',
    label: 'Build store',
    group: 'builds',
    path: 'apps/build-service/src/store.ts',
    signature: 'builds',
    fields: ['buildId', 'sourceHash', 'status'],
  },
  {
    id: 'compile-service',
    kind: 'service',
    label: 'Compile service',
    group: 'builds',
    path: 'apps/compile-service',
    signature: 'compile(input: SourceHash): Artifact',
    fields: ['sourceHash', 'artifact'],
  },
  {
    id: 'artifact-cache',
    kind: 'cache',
    label: 'Artifact cache',
    group: 'builds',
    path: 'apps/compile-service/src/artifact-cache.ts',
    signature: 'get(key: SourceHash): Artifact | miss',
    fields: ['sourceHash'],
  },
  {
    id: 'package-registry',
    kind: 'external',
    label: 'Package registry',
    group: 'external',
    path: 'integrations/package-registry',
    signature: 'Publish(request: Package): RegistryReceipt',
    fields: ['sourceHash'],
  },
  {
    id: 'build-events',
    kind: 'queue',
    label: 'Build events',
    group: 'builds',
    path: 'contracts/events/build-finished.ts',
    signature: 'BuildFinished { buildId, sourceHash }',
    fields: ['buildId', 'sourceHash'],
  },
  {
    id: 'release-service',
    kind: 'service',
    label: 'Release service',
    group: 'release',
    path: 'apps/release-service',
    signature: 'promote(buildId: BuildId): Release',
    fields: ['releaseId', 'buildId', 'status'],
  },
  {
    id: 'retry-worker',
    kind: 'function',
    label: 'Retry worker',
    group: 'builds',
    path: 'apps/build-service/src/retry-worker.ts',
    signature: 'backoff(attempt): Duration',
    fields: ['attempt', 'buildId'],
  },
]

export const SCHEMA_TYPES: SchemaType[] = [
  { name: 'Build', fields: ['id', 'sourceHash', 'status', 'artifact'] },
  { name: 'BuildInput', fields: ['sourceHash', 'repoId'] },
  { name: 'BuildFinished', fields: ['buildId', 'sourceHash'] },
  { name: 'Release', fields: ['id', 'buildId', 'status'] },
  { name: 'Artifact', fields: ['digest', 'size'] },
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
