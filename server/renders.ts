import type { Component, RenderJob } from '../shared/types.ts'
import { matchFigure } from '../shared/figures.ts'

const BANNED = /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|document\.cookie|window\.parent|parent\.|top\.location|import\s*\(|https?:\/\//gi

export function sanitizeRenderHtml(html: string): { html: string; stripped: boolean } {
  let next = html.slice(0, 200_000)
  const stripped = BANNED.test(next)
  BANNED.lastIndex = 0
  if (stripped) next = next.replace(BANNED, '/* blocked */')
  next = next.replace(/<script[^>]+src=[^>]*>\s*<\/script>/gi, '')
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;">`
  if (next.includes('<head>')) next = next.replace('<head>', `<head>${csp}`)
  else next = `<!doctype html><html><head>${csp}</head><body>${next}</body></html>`
  return { html: next, stripped }
}

export function builtinRender(component: Component, why: string): string {
  const figure = matchFigure(component)
  if (figure === 'retry' || /retry|backoff/i.test(why + component.id)) return retryHtml(component)
  return genericHtml(component, why)
}

function retryHtml(component: Component): string {
  const attempts = component.behaviour.retry?.attempts ?? 3
  const backoff = component.behaviour.retry?.backoffMs ?? 200
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #07090c; color: #e8fbff; font: 14px/1.4 "IBM Plex Mono", ui-monospace, monospace; }
  main { padding: 28px; }
  h1 { font-weight: 500; letter-spacing: 0.14em; font-size: 12px; color: #7d8f9a; }
  p { font-family: "Iowan Old Style", Georgia, serif; font-size: 22px; letter-spacing: -0.02em; max-width: 36ch; }
  .row { display: flex; gap: 10px; align-items: end; height: 160px; margin: 28px 0; }
  .bar { width: 42px; background: linear-gradient(#16323a, #3ee0ff); border: 1px solid #3ee0ff; transform-origin: bottom; }
  label { display: block; color: #7d8f9a; letter-spacing: 0.12em; font-size: 11px; margin-top: 18px; }
  input { width: min(360px, 100%); accent-color: #3ee0ff; }
  .readout { margin-top: 12px; color: #9fd7e4; }
</style>
</head>
<body>
<main>
  <h1>RETRY · ${escapeHtml(component.id)}</h1>
  <p>Each miss waits longer, then the message leaves the request path for the dead letter.</p>
  <div class="row" id="bars"></div>
  <label for="base">BASE BACKOFF ${backoff} ms</label>
  <input id="base" type="range" min="50" max="2000" value="${backoff}" />
  <div class="readout" id="read"></div>
</main>
<script>
  const attempts = ${attempts};
  const bars = document.getElementById('bars');
  const base = document.getElementById('base');
  const read = document.getElementById('read');
  function draw() {
    const ms = Number(base.value);
    bars.innerHTML = '';
    const waits = [];
    for (let i = 1; i <= attempts; i++) {
      const wait = ms * Math.pow(2, i - 1);
      waits.push(wait);
      const el = document.createElement('div');
      el.className = 'bar';
      el.style.height = Math.min(140, 24 + wait / 20) + 'px';
      el.title = 'attempt ' + i;
      bars.appendChild(el);
    }
    const dead = document.createElement('div');
    dead.className = 'bar';
    dead.style.height = '16px';
    dead.style.background = '#ff7a1a';
    dead.style.borderColor = '#ff7a1a';
    bars.appendChild(dead);
    read.textContent = waits.map((w, i) => 'attempt ' + (i + 1) + ' · ' + w + ' ms').join('   ') + '   then DLQ';
  }
  base.addEventListener('input', draw);
  draw();
</script>
</body>
</html>`
}

function genericHtml(component: Component, why: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<style>
  body { margin: 0; background: #07090c; color: #e8fbff; font-family: Georgia, serif; }
  main { padding: 32px; }
  small { font-family: ui-monospace, monospace; letter-spacing: 0.14em; color: #7d8f9a; }
  h1 { font-weight: 400; font-size: 32px; }
  p { max-width: 42ch; color: #c5d4dc; }
</style></head>
<body><main>
  <small>${escapeHtml(component.kind)} · ${escapeHtml(component.id)}</small>
  <h1>${escapeHtml(component.label)}</h1>
  <p>${escapeHtml(why)}</p>
  <p>${escapeHtml(component.notes ?? 'Shape only. No live contents.')}</p>
</main></body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
}

export function queuedRender(partial: Omit<RenderJob, 'status' | 'createdAt'> & { status?: RenderJob['status'] }): RenderJob {
  return {
    ...partial,
    status: partial.status ?? 'queued',
    createdAt: new Date().toISOString(),
  }
}
