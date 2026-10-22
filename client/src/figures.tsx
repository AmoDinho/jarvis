export function LibraryFigure({ name }: { name: string }) {
  const kind = /retry|backoff/.test(name) ? 'retry' : /cache/.test(name) ? 'cache' : /queue|letter/.test(name) ? 'queue' : /store/.test(name) ? 'store' : 'service'
  return (
    <svg viewBox="0 0 280 160" role="img" aria-label={`${kind} figure`}>
      <rect width="280" height="160" fill="#07090c" />
      {kind === 'retry' ? <Retry /> : null}
      {kind === 'cache' ? <Cache /> : null}
      {kind === 'queue' ? <Queue /> : null}
      {kind === 'store' ? <Store /> : null}
      {kind === 'service' ? <Service /> : null}
      <text x="16" y="148" fill="#7d8f9a" fontSize="10" letterSpacing="1.5">
        TIER 1 · {kind.toUpperCase()} · SHAPE ONLY
      </text>
    </svg>
  )
}

function Retry() {
  return (
    <g fill="none" stroke="#3ee0ff">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={28 + i * 62} y={110 - (i + 1) * 22} width="36" height={(i + 1) * 22} />
      ))}
      <rect x="214" y="96" width="36" height="14" stroke="#ff8a1e" />
      <text x="214" y="90" fill="#ff8a1e" fontSize="9" stroke="none">
        DLQ
      </text>
    </g>
  )
}

function Cache() {
  return (
    <g fill="none" stroke="#3ee0ff">
      <polygon points="140,28 188,52 140,76 92,52" />
      <polygon points="140,48 188,72 140,96 92,72" opacity="0.7" />
      <text x="108" y="118" fill="#9aefff" fontSize="10" stroke="none">
        hit stops · miss continues
      </text>
    </g>
  )
}

function Queue() {
  return (
    <g fill="none" stroke="#3ee0ff">
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={40 + i * 18} y={36 + i * 10} width="150" height="16" opacity={1 - i * 0.15} />
      ))}
    </g>
  )
}

function Store() {
  return (
    <g fill="none" stroke="#3ee0ff">
      <ellipse cx="140" cy="46" rx="54" ry="16" />
      <path d="M86 46 v48 c0 10 24 18 54 18 s54-8 54-18 V46" />
      <ellipse cx="140" cy="70" rx="54" ry="16" opacity="0.5" />
    </g>
  )
}

function Service() {
  return (
    <g fill="none" stroke="#3ee0ff">
      <circle cx="140" cy="72" r="28" />
      <circle cx="140" cy="72" r="6" fill="#e8fbff" stroke="none" />
      <path d="M140 28 v16 M140 100 v16 M96 72 h-16 M184 72 h16" />
    </g>
  )
}
