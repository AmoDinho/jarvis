import type { ComponentKind, PatchOp, Scenario, Scene, ViewName } from '../shared/types.ts'
import { findComponent } from '../shared/patch.ts'
import { slugify } from '../shared/format.ts'
import {
  QUOTE_SATELLITES,
  opsForBulkhead,
  opsForCache,
  opsForEvents,
  opsForRetry,
  policyMachinePatch,
  quoteStages,
} from '../shared/quote-flow.ts'

export type TurnPlan = {
  sentences: string[]
  batches: { why: string; ops: PatchOp[] }[]
  decision?: { chose: string; rejected?: string[]; because: string; affects: string[] }
  decisions?: { chose: string; rejected?: string[]; because: string; affects: string[] }[]
  simulation?: Scenario | 'last'
  view?: ViewName
  writeUp?: boolean
  keepRender?: boolean
  escalate?: { componentId: string; why: string }
  groundedStars?: boolean
}

const STORY_DECISIONS: NonNullable<TurnPlan['decisions']> = [
  {
    chose: 'Split rating out of quote service',
    rejected: ['Keep one service'],
    because: 'Rating changes weekly, quoting rarely',
    affects: ['rating-service', 'quote-service'],
  },
  {
    chose: 'Pricing cache in front of the partner',
    rejected: ['Call the partner every time'],
    because: 'Repeat risks are common and partner latency is the long pole',
    affects: ['pricing-cache', 'rating-partner'],
  },
  {
    chose: 'Emit QuoteCreated as an event',
    rejected: ['Policy polls the quote store'],
    because: 'Policy should not read another domain’s tables',
    affects: ['quote-service', 'policy-service'],
  },
  {
    chose: 'Retry worker with backoff, then dead-letter',
    rejected: ['Inline retries in quote service'],
    because: 'Keeps the request path fast when delivery fails',
    affects: ['retry-worker', 'quote-events'],
  },
]

export function planTurn(input: {
  text: string
  scene: Scene
  mode: 'blank' | 'grounded'
  lastScenario?: Scenario
}): TurnPlan {
  const text = input.text.trim()
  const n = norm(text)
  const scene = input.scene

  if (!n) {
    return say(['I did not catch that.', 'Hold space and try the phrase again, or type it.'])
  }

  if (/\b(write it up|write-up|write up|generate the spec|spec doc)\b/.test(n)) {
    return { ...say(['I will write the spec from the scene, the decisions and the snapshots.', 'Only what the model holds is saved.']), writeUp: true, view: 'writeup' }
  }

  if (/\bkeep this( one)?\b/.test(n)) {
    return {
      ...say(['I will keep the focused figure with this version.', 'A full Anatomy machine is a later render. This session stores the figure, not a pretend one.']),
      keepRender: true,
    }
  }

  if (/\btidy( the scene| it)?\b/.test(n)) {
    return {
      sentences: ['Tidied. Each domain has its own row, and nothing shares a cell.', 'The graph is unchanged. Only the grid moved.'],
      batches: [{ why: 'Tidied the grid', ops: [{ op: 'tidy' }] }],
    }
  }

  if (/\b(orbital|constellation|war room|decisions|evolution)\b/.test(n) && !/\b(add|load|what|walk|happens)\b/.test(n)) {
    const view = n.includes('constellation')
      ? 'constellation'
      : n.includes('war room')
        ? 'warroom'
        : n.includes('decision') || n.includes('evolution')
          ? 'decisions'
          : 'orbital'
    return { ...say([`Opening ${view === 'warroom' ? 'the war room' : view}.`, 'The scene is unchanged.']), view }
  }

  if (/\b(assemble the quote flow demo|build the mockup scene|full quote flow demo)\b/.test(n)) {
    return assembleDemo(scene)
  }

  if (/\b(load the quote flow|quote flow as it is|as it is today|seed the scene|load today)\b/.test(n)) {
    return loadToday(scene, input.mode)
  }

  if (/\bstep through\b/.test(n) || /\bstate machine\b/.test(n)) {
    return stepMachine(scene, n)
  }

  if (/\b(re-?run|run it again|same load)\b/.test(n) && input.lastScenario) {
    return {
      sentences: [],
      batches: [],
      simulation: 'last',
      view: input.lastScenario.mode === 'flow' ? 'orbital' : 'warroom',
    }
  }

  if (/\b(walk|trace|where (the|does the) time)\b/.test(n)) {
    const entry = entryOf(scene, n) ?? 'web-client'
    if (!scene.components.some((c) => c.id === entry)) {
      return say(['There is no path to walk yet.', 'Load a flow, or add a client and a service, and I will trace it.'])
    }
    return {
      sentences: [],
      batches: [],
      simulation: { mode: 'flow', entry, prompt: text },
      view: 'orbital',
    }
  }

  if (/\b(what happens|load|rps|requests per second|saturat)\b/.test(n)) {
    const entry = entryOf(scene, n)
    if (!entry) return say(['I need an entry point before I can run load.', 'Add a client, or load the quote flow.'])
    return {
      sentences: [],
      batches: [],
      simulation: {
        mode: 'load',
        entry,
        rps: numberAfter(n, /(\d+(?:\.\d+)?)\s*(?:rps|requests)/) ?? 500,
        durationS: numberAfter(n, /(\d+)\s*(?:s|sec|seconds)\b/) ?? 30,
        faults: faultsFrom(scene, n),
        prompt: text,
      },
      view: 'warroom',
    }
  }

  if (/\bbulkhead\b/.test(n)) {
    return bulkhead(scene, n)
  }

  if (/\b(pricing cache|cache in front|put a cache|add a cache)\b/.test(n)) {
    return cache(scene)
  }

  if (/\b(retry worker|backoff|dead letter|dead-letter|dlq)\b/.test(n)) {
    return retry(scene, n)
  }

  if (/\b(emit|quote created|quotecreated|as an event)\b/.test(n)) {
    return events(scene)
  }

  if (/\b(open question|leave (this|these) open|should the|should we|who owns|is reinstatement)\b/.test(n)) {
    return questions(text, n)
  }

  if (/\b(how does|how do|show me how|illustrate|walk me through the)\b/.test(n)) {
    return escalate(scene, n, text)
  }

  if (/\b(focus on|tell me about|describe)\b/.test(n)) {
    return describe(scene, n, text)
  }

  if (/\b(remove|delete)\b/.test(n)) {
    return remove(scene, n)
  }

  if (/\bconnect\b/.test(n)) {
    return connect(scene, n)
  }

  if (/\bsplit\b/.test(n) && /\brating\b/.test(n)) {
    return splitRating(scene)
  }

  if (/\badd\b/.test(n) || scene.components.length === 0) {
    const added = parseAdds(text)
    if (added.length) return addMany(scene, added, input.mode)
  }

  const mentioned = mentionedComponent(scene, n)
  if (mentioned) return describe(scene, mentioned.id, text)

  return say([
    'I can add a part, connect two of them, or run a flow.',
    'Try “load the quote flow as it is today”, or name a service and I will place it.',
  ])
}

function assembleDemo(scene: Scene): TurnPlan {
  if (scene.components.length) {
    return say(['This session already has a scene.', 'Start a new one if you want the full quote-flow demo from an empty grid.'])
  }
  const batches = quoteStages.map((stage) => ({ why: stage.why, ops: stage.ops }))
  batches.push({
    why: 'Partner bulkhead',
    ops: [
      ...opsForBulkhead(32),
      { op: 'question', text: 'Should the cache key include the postcode?' },
      { op: 'question', text: 'Is reinstatement from Lapsed in scope?' },
      { op: 'question', text: 'Who owns the dead-letter queue alerts?' },
      { op: 'satellites', satellites: QUOTE_SATELLITES },
      { op: 'focus', id: 'quote-service' },
    ],
  })
  return {
    sentences: [
      'Assembled the quote flow through the partner bulkhead.',
      'Eight versions, from the first client to the cache, the event, and thirty-two rating workers.',
      'Ask me to walk a request, or what happens at five hundred requests a second.',
    ],
    batches,
    decisions: [
      ...STORY_DECISIONS,
      {
        chose: 'Bulkhead the partner call to 32 workers',
        rejected: ['Raise rating capacity without a limit'],
        because: 'The load simulation saturates rating first',
        affects: ['rating-service', 'rating-partner'],
      },
    ],
    view: 'orbital',
    groundedStars: true,
  }
}

function loadToday(scene: Scene, mode: 'blank' | 'grounded'): TurnPlan {
  const stages = quoteStages.slice(0, 5).filter((stage) => stage.ops.some((op) => op.op === 'add' && !scene.components.some((c) => c.id === op.component.id)))
  if (!stages.length) {
    return {
      ...say(['The quote flow is already on the board.', 'I can walk a request, or we can change it.']),
      view: mode === 'grounded' ? 'constellation' : 'orbital',
    }
  }
  const batches = stages.map((stage) => ({ why: stage.why, ops: stage.ops }))
  if (mode === 'grounded') {
    batches.push({ why: 'Shape stars', ops: [{ op: 'satellites', satellites: QUOTE_SATELLITES }, { op: 'focus', id: 'quote-service' }] })
  }
  const grounded = mode === 'grounded'
  return {
    sentences: grounded
      ? [
          'Loaded the quote flow as it stands today.',
          'A client hits the gateway, quote service prices through rating and the partner, and policy still polls the store.',
          'Shape only. No records, no logs, no example values.',
        ]
      : [
          'Sketched the quote flow from a blank slate.',
          'Client, gateway, quote service, store, rating and the partner. Policy still polls the store.',
          'We can put a cache in front of the partner whenever you want.',
        ],
    batches,
    view: grounded ? 'constellation' : 'orbital',
    groundedStars: grounded,
  }
}

function stepMachine(scene: Scene, n: string): TurnPlan {
  const target = mentionedComponent(scene, n) ?? scene.components.find((c) => c.id === 'policy-service')
  if (!target) return say(['There is no component to step yet.', 'Add a service, then ask me to step its machine.'])
  const batches: TurnPlan['batches'] = []
  if (!target.machine && target.id === 'policy-service') {
    batches.push({ why: 'Policy state machine', ops: [policyMachinePatch(), { op: 'focus', id: 'policy-service' }] })
  } else if (!target.machine) {
    return say([`${target.label} has no state machine.`, 'I can step a request through the graph instead. Say walk a request.'])
  }
  return {
    sentences: [],
    batches,
    simulation: { mode: 'step', entry: target.id, machineId: target.id, prompt: `Step through ${target.label}` },
    view: 'warroom',
  }
}

function bulkhead(scene: Scene, n: string): TurnPlan {
  if (!scene.components.some((c) => c.id === 'rating-service')) {
    return say(['There is no rating service to bulkhead.', 'Split rating out first, then cap its workers.'])
  }
  const workers = numberAfter(n, /(\d+)\s*workers/) ?? numberAfter(n, /to\s*(\d+)/) ?? 32
  const affects = ['rating-service', scene.components.some((c) => c.id === 'rating-partner') ? 'rating-partner' : ''].filter(Boolean)
  return {
    sentences: [
      `Rating is capped at ${workers} workers, so the partner call cannot take the whole quote path with it.`,
      'I logged that against leaving the fan-out unbounded.',
    ],
    batches: [{ why: 'Partner bulkhead', ops: [...opsForBulkhead(workers), { op: 'focus', id: 'rating-service' }] }],
    decision: {
      chose: `Bulkhead the partner call to ${workers} workers`,
      rejected: ['Raise rating capacity without a limit'],
      because: 'The load simulation saturates rating first',
      affects,
    },
    view: 'orbital',
  }
}

function cache(scene: Scene): TurnPlan {
  const ops = opsForCache(scene)
  if (!ops.length) {
    return say(['I need a rating service before a pricing cache means anything.', 'Split rating out, then ask again.'])
  }
  if (scene.components.some((c) => c.id === 'pricing-cache') && ops.every((op) => op.op === 'connect' || op.op === 'disconnect') && ops.length === 0) {
    return say(['The pricing cache is already in front of the partner.', 'I can walk a request if you want to see the miss path.'])
  }
  return {
    sentences: [
      'Pricing cache now sits in front of the partner.',
      'Repeat risks skip the long call. A miss still goes out.',
      'I logged that against calling the partner every time.',
    ],
    batches: [{ why: 'Pricing cache', ops: [...ops, { op: 'focus', id: 'pricing-cache' }] }],
    decision: {
      chose: 'Pricing cache in front of the partner',
      rejected: ['Call the partner every time'],
      because: 'Repeat risks are common and partner latency is the long pole',
      affects: ['pricing-cache', 'rating-partner'].filter((id) => scene.components.some((c) => c.id === id) || id === 'pricing-cache'),
    },
  }
}

function events(scene: Scene): TurnPlan {
  if (!scene.components.some((c) => c.id === 'quote-service')) {
    return say(['Quote service is not on the board yet.', 'Add it, then I can emit QuoteCreated.'])
  }
  const ops = opsForEvents(scene)
  if (!ops.length) return say(['QuoteCreated is already an event.', 'Policy is off the store poll.'])
  return {
    sentences: [
      'Quote creation now emits QuoteCreated.',
      'Policy can hear it without reading the quote tables.',
      'I logged that against the poll.',
    ],
    batches: [{ why: 'QuoteCreated event', ops }],
    decision: {
      chose: 'Emit QuoteCreated as an event',
      rejected: ['Policy polls the quote store'],
      because: 'Policy should not read another domain’s tables',
      affects: ['quote-service', 'policy-service'].filter((id) => scene.components.some((c) => c.id === id) || id === 'quote-service'),
    },
  }
}

function retry(scene: Scene, n: string): TurnPlan {
  const withEvent = /\bevent\b/.test(n) || /\bemit\b/.test(n)
  const ops = [...(withEvent ? opsForEvents(scene) : []), ...opsForRetry(scene)]
  if (!scene.components.some((c) => c.id === 'quote-service') && !scene.components.some((c) => c.id === 'quote-events')) {
    return say(['I need the quote path before a retry worker has anything to catch.', 'Load the flow, or add quote service.'])
  }
  return {
    sentences: [
      'Failed deliveries now back off, then dead-letter.',
      'The request path stays short. The worker owns the wait.',
    ],
    batches: [{ why: 'Retry then dead-letter', ops: ops.length ? ops : [{ op: 'focus', id: 'retry-worker' }] }],
    decision: {
      chose: 'Retry worker with backoff, then dead-letter',
      rejected: ['Inline retries in quote service'],
      because: 'Keeps the request path fast when delivery fails',
      affects: ['retry-worker', 'quote-events'],
    },
    escalate: { componentId: 'retry-worker', why: 'How the retry worker backs off, then dead-letters.' },
  }
}

function questions(text: string, n: string): TurnPlan {
  const found = text.match(/[^.?!]+[.?!]?/g)?.map((part) => part.trim()).filter((part) => /should|who|is |open/i.test(part)) ?? []
  let items = found.length ? found : [text.trim()]
  if (/\bleave these open\b/.test(n)) {
    items = text
      .split(/,| and /i)
      .map((part) => part.replace(/^.*leave these open:?\s*/i, '').trim())
      .filter((part) => part.length > 8)
  }
  const ops: PatchOp[] = items.slice(0, 4).map((item) => ({
    op: 'question' as const,
    text: item.replace(/[.]+$/, '').trim().slice(0, 200),
  }))
  return {
    sentences: [
      items.length > 1 ? `Left ${items.length} questions open.` : 'Left that open.',
      'They stay in the spec until you close them. I will not invent an answer.',
    ],
    batches: [{ why: 'Open question', ops }],
  }
}

function escalate(scene: Scene, n: string, text: string): TurnPlan {
  const target = mentionedComponent(scene, n) ?? scene.components.find((c) => c.id === scene.focus)
  if (!target) return say(['Tell me which part to draw.', 'Focus a component, then ask how it works.'])
  return {
    sentences: [
      `I will draw ${target.label}. The voice will not wait on it.`,
      'When it lands, I can walk it at the next pause.',
    ],
    batches: [{ why: `Render ${target.label}`, ops: [{ op: 'focus', id: target.id }] }],
    escalate: { componentId: target.id, why: text },
  }
}

function describe(scene: Scene, n: string, text: string): TurnPlan {
  const target = mentionedComponent(scene, n) ?? mentionedComponent(scene, text)
  if (!target) return say(['I cannot see that part on the board.', 'Name it again, or add it.'])
  const edges = scene.edges.filter((e) => e.from === target.id || e.to === target.id)
  const already = scene.focus === target.id
  return {
    sentences: [
      `${target.label} is a ${target.kind}${target.group ? ` in ${target.group}` : ''}, about ${target.behaviour.latencyMs} milliseconds at ${Math.round(target.behaviour.capacityRps)} requests a second.`,
      edges.length
        ? `It has ${edges.length} ${edges.length === 1 ? 'edge' : 'edges'}. ${target.notes ?? 'That is the shape I have.'}`
        : target.notes ?? 'Nothing is connected to it yet.',
    ].slice(0, 3),
    batches: already ? [] : [{ why: `Focus ${target.label}`, ops: [{ op: 'focus', id: target.id }] }],
  }
}

function remove(scene: Scene, n: string): TurnPlan {
  const target = mentionedComponent(scene, n.replace(/\b(remove|delete)\b/g, ''))
  if (!target) return say(['I cannot tell which part to remove.', 'Name it, for example remove the dead letter.'])
  return {
    sentences: [`Removed ${target.label}, and the edges that touched it.`, 'Say if you want the grid tidied.'],
    batches: [{ why: `Removed ${target.label}`, ops: [{ op: 'remove', id: target.id }] }],
  }
}

function connect(scene: Scene, n: string): TurnPlan {
  const match = n.match(/connect (.+?) to (.+)/)
  if (!match) return say(['Say connect A to B.', 'I will pick sync unless you say event, async or stream.'])
  const from = mentionedComponent(scene, match[1] ?? '')
  const to = mentionedComponent(scene, match[2] ?? '')
  if (!from || !to) return say(['I could not find both ends.', 'Add them first, then connect them.'])
  const style = /\bevent\b/.test(n) ? 'event' : /\basync\b/.test(n) ? 'async' : /\bstream\b/.test(n) ? 'stream' : 'sync'
  return {
    sentences: [`Connected ${from.label} to ${to.label}, ${style}.`, 'The rest of the scene is untouched.'],
    batches: [{ why: `${from.id} → ${to.id}`, ops: [{ op: 'connect', edge: { from: from.id, to: to.id, style } }] }],
  }
}

function splitRating(scene: Scene): TurnPlan {
  if (scene.components.some((c) => c.id === 'rating-service')) {
    return say(['Rating is already its own service.', 'I can connect it, or walk a request through it.'])
  }
  if (!scene.components.some((c) => c.id === 'quote-service')) {
    return say(['Add quote service first.', 'Then I can split rating out of it.'])
  }
  const stage = quoteStages.find((item) => item.id === 'rating')!
  return {
    sentences: ['Rating is its own service now.', 'Quote still calls it, synchronously, until we change that.'],
    batches: [{ why: stage.why, ops: stage.ops }],
    decision: {
      chose: 'Split rating out of quote service',
      rejected: ['Keep one service'],
      because: 'Rating changes weekly, quoting rarely',
      affects: ['rating-service', 'quote-service'],
    },
  }
}

function addMany(
  scene: Scene,
  items: { id: string; kind: ComponentKind; label: string; group: string }[],
  mode: 'blank' | 'grounded',
): TurnPlan {
  const fresh = items.filter((item) => !scene.components.some((c) => c.id === item.id))
  if (!fresh.length) return say(['Those parts are already on the board.', 'I can connect them, or focus one.'])
  const ops: PatchOp[] = fresh.map((item) => ({
    op: 'add',
    component: { id: item.id, kind: item.kind, label: item.label, group: item.group, notes: item.label },
  }))
  const chain = [...scene.components.map((c) => c.id), ...fresh.map((item) => item.id)]
  for (let i = scene.components.length; i < chain.length - 1; i++) {
    const from = chain[i]
    const to = chain[i + 1]
    if (!from || !to) continue
    const next = fresh.find((item) => item.id === to)
    const style = next?.kind === 'queue' ? 'async' : 'sync'
    ops.push({ op: 'connect', edge: { from, to, style } })
  }
  const last = fresh[fresh.length - 1]
  if (last) ops.push({ op: 'focus', id: last.id })
  const names = fresh.map((item) => item.label).join(', ')
  return {
    sentences: [
      mode === 'grounded'
        ? `Placed ${names}. I have not read live data — only the shape you named.`
        : `Placed ${names}.`,
      fresh.length > 1 ? 'I connected them in the order you said, sync unless the last part is a queue.' : 'Nothing else moved.',
    ],
    batches: [{ why: `Added ${names}`, ops }],
    view: 'orbital',
  }
}

function parseAdds(text: string): { id: string; kind: ComponentKind; label: string; group: string }[] {
  const withoutLead = text.replace(/^.*?\badd\b/i, '').replace(/^.*?\bdesign\b/i, '')
  const chunks = withoutLead
    .split(/,|\band\b/i)
    .map((chunk) => chunk.replace(/\b(a|an|the|let's|lets|please|with|then)\b/gi, ' ').replace(/[^a-zA-Z0-9 -]/g, ' ').trim())
    .filter((chunk) => chunk.length > 2 && !/^(i want|we need|feature)$/i.test(chunk))
  const items = []
  for (const chunk of chunks) {
    const kind = kindOf(chunk)
    const label = titleCase(chunk.replace(/\b(service|queue|store|cache|gateway|client|worker|function)\b/gi, '').trim() || chunk)
    const id = slugify(chunk.replace(/\b(a|an|the)\b/g, ''))
    if (!id || id.length < 2) continue
    items.push({ id, kind, label: label || id, group: groupOf(kind) })
  }
  return items.slice(0, 8)
}

function kindOf(chunk: string): ComponentKind {
  const n = chunk.toLowerCase()
  if (/\b(client|web|browser|form|app)\b/.test(n)) return 'client'
  if (/\bgateway\b/.test(n)) return 'gateway'
  if (/\b(queue|topic|bus)\b/.test(n)) return 'queue'
  if (/\b(store|database|db)\b/.test(n)) return 'store'
  if (/\bcache\b/.test(n)) return 'cache'
  if (/\b(partner|vendor|external)\b/.test(n)) return 'external'
  if (/\b(worker|function)\b/.test(n)) return 'function'
  return 'service'
}

function groupOf(kind: ComponentKind): string {
  if (kind === 'client' || kind === 'gateway') return 'edge'
  if (kind === 'external') return 'external'
  return 'core'
}

function faultsFrom(scene: Scene, n: string): Scenario['faults'] {
  const mode = /\bdown\b/.test(n) ? 'down' : /\bthrottl/.test(n) ? 'throttled' : /\btimeout\b/.test(n) ? 'timeout' : /\bslow\b/.test(n) ? 'slow' : null
  if (!mode) return undefined
  const factor = numberAfter(n, /(?:x|times)\s*(\d+(?:\.\d+)?)/) ?? numberAfter(n, /(\d+(?:\.\d+)?)\s*times/) ?? (mode === 'timeout' ? 8 : 4)
  const hinted = mentionedComponent(scene, n.replace(/\d+/g, ''))
  const component = hinted?.id ?? (n.includes('rating') ? 'rating-service' : n.includes('partner') ? 'rating-partner' : n.includes('gateway') ? 'api-gateway' : scene.focus)
  if (!component || !scene.components.some((c) => c.id === component)) return undefined
  return [{ component, mode, factor }]
}

function entryOf(scene: Scene, n: string): string | undefined {
  if (/\bfrom the gateway\b/.test(n)) return scene.components.find((c) => c.kind === 'gateway')?.id
  if (/\bfrom the client\b/.test(n) || /\bquote request\b/.test(n) || /\bweb client\b/.test(n)) {
    return scene.components.find((c) => c.id === 'web-client')?.id ?? scene.components.find((c) => c.kind === 'client')?.id
  }
  return scene.components.find((c) => c.kind === 'client')?.id ?? scene.components[0]?.id
}

function mentionedComponent(scene: Scene, hint: string) {
  const cleaned = hint.toLowerCase()
  const alias: [string, string][] = [
    ['rating partner', 'rating-partner'],
    ['the partner', 'rating-partner'],
    ['partner', 'rating-partner'],
    ['pricing cache', 'pricing-cache'],
    ['the cache', 'pricing-cache'],
    ['cache', 'pricing-cache'],
    ['rating service', 'rating-service'],
    ['rating', 'rating-service'],
    ['quote service', 'quote-service'],
    ['quote', 'quote-service'],
    ['api gateway', 'api-gateway'],
    ['gateway', 'api-gateway'],
    ['web client', 'web-client'],
    ['client', 'web-client'],
    ['quote store', 'quote-store'],
    ['store', 'quote-store'],
    ['policy service', 'policy-service'],
    ['policy', 'policy-service'],
    ['retry worker', 'retry-worker'],
    ['retry', 'retry-worker'],
    ['dead letter', 'dead-letter'],
    ['quote events', 'quote-events'],
    ['events', 'quote-events'],
  ]
  for (const [needle, id] of alias) {
    if (cleaned.includes(needle)) {
      const found = scene.components.find((c) => c.id === id)
      if (found) return found
    }
  }
  return findComponent(scene, hint)
}

function numberAfter(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function say(sentences: string[]): TurnPlan {
  return { sentences, batches: [] }
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9%+.' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
