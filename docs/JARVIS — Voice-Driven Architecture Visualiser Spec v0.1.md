# JARVIS — Voice-Driven Architecture Visualiser: Spec v0.1

Oct 12, 2026 · @Amogelang

## Vision and principles

JARVIS is a single-user browser app where I talk through a software feature by voice, Claude answers out loud, and a holographic isometric scene of the architecture keeps rebuilding itself around the conversation. Every session ends as a written spec with versioned diagrams.

1. **One model, many views.** The scene model is the single source of truth. The diagram, the simulations, the voice walkthrough and the spec doc all read from it, so they cannot disagree.
2. **Voice is instant, visuals take their time.** The voice loop never waits on a render. Renders run in a queue; when one lands, Claude walks through what changed.
3. **Edit, don't redraw.** Each turn produces a small diff against the scene model, not a fresh picture. That keeps state stable and makes every change explainable.
4. **One lit part.** At any moment exactly one component glows: the one Claude is talking about (borrowed from Anatomy).
5. **Shape, never contents.** Grounded mode reads code structure and schemas, never live data or customer PII.

## Decisions so far

These came out of the ideation interview on 12 October 2026.

| Area | Decision | Why it matters |
| --- | --- | --- |
| Domain | Software features and architecture | Scene vocabulary is services, queues, stores, APIs, events |
| Surface | Standalone browser app, local Node server | Keeps API keys off the client |
| Stack | Vite + React + TypeScript | Fast dev loop; three.js via react-three-fiber |
| Users | Just me | No auth, no sharing, runs locally |
| Input | Push-to-talk (hold a key) | No voice-activity detection, echo cancellation or barge-in |
| Voice quality | Good enough, cheap or free | Browser speech APIs first, swappable later |
| Latency | Minutes is fine if it's stunning | Renders can be heavy; voice must still be instant |
| Look | Dark holographic HUD, cyan glow | WebGL with bloom, not flat SVG |
| Simulations | Flow, failure and load, step-through | Components need behaviour, not just shapes |
| Context | Blank slate or grounded, toggled per session | Grounded reads repos and schemas only |
| Output | Written spec doc plus diagrams | Decision log captured during the session |
| V1 goal | Thin slice of everything | Every layer exists end to end, each one shallow |

## System architecture

The system is three layers: a browser app, a small local Node server, and external services. The orchestrator is the only part that talks to Claude.

&#91;embedded content: system architecture · browser, local server, external services\]

A voice turn runs along the top row and returns speech in seconds. The scene store fans each change out to the HUD at once, and only big changes drop into the render queue, whose results arrive later as panels.

## The scene model

The scene model is a typed JSON document that Claude edits through tool calls, never by rewriting it whole. Each turn returns a list of patch operations; the server validates them, applies them, bumps the version and stores a snapshot.

```typescript
type Scene = {
  version: number;
  title: string;
  components: Component[];
  edges: Edge[];
  decisions: Decision[];
  openQuestions: string[];
  focus?: string;            // id of the one lit component
};

type Component = {
  id: string;
  kind: 'service' | 'queue' | 'store' | 'cache' | 'gateway' | 'client' | 'external' | 'function';
  label: string;
  group?: string;            // bounded context / domain
  position?: [number, number]; // grid cell, auto-laid out if absent
  behaviour: {
    latencyMs: number;       // p50
    capacityRps: number;
    concurrency?: number;
    retry?: { attempts: number; backoffMs: number };
    failureModes: string[];  // e.g. 'timeout', 'throttled', 'down'
  };
  notes?: string;
};

type Edge = {
  id: string;
  from: string; to: string;
  style: 'sync' | 'async' | 'event' | 'stream';
  label?: string;            // e.g. 'POST /builds', 'BuildFinished'
};

type Decision = {
  id: string; at: string;    // ISO time
  chose: string; rejected?: string[]; because: string;
  affects: string[];         // component ids
};
```

Claude gets three tools against it: `patch_scene` (add, update, remove, connect, set focus), `log_decision`, and `run_simulation`. Keeping behaviour numbers on every component is what makes the simulations possible later; Claude fills sensible defaults and I correct them by voice.

## Voice loop

The voice loop is hold-to-talk in, streamed speech out, and it never waits on a render.

1. Hold Space: the mic opens and the HUD shows a live waveform.
2. Release: the transcript goes to the server with the current scene version and the last few turns.
3. Claude streams back two things in parallel: spoken text and scene tool calls.
4. Spoken text is split at sentence boundaries and each sentence is voiced as soon as it completes, so speech starts within a second or two.
5. Tool calls patch the scene; if the change is big enough, a render job is queued.
6. Pressing Space while Claude is speaking stops playback and starts a new turn.

**Speech-to-text.** Start with the browser's built-in Web Speech recognition (free, good accuracy in Chrome). Fallback: Whisper running locally, if browser recognition proves unreliable with technical vocabulary.

**Text-to-speech.** Start with the browser's built-in speech synthesis. Upgrade path: a small open-source neural voice running locally, for a more Jarvis-like sound at no per-minute cost. Both sit behind one `Voice` interface so the swap is a config change.

**Speaking style.** The system prompt keeps spoken replies to two to four sentences, without lists or code. Detail goes into the scene and the spec doc, not into the ear.

## Render pipeline

The main HUD is drawn by my own deterministic renderer from the scene model, so it updates in under a second; Claude's minutes go into bespoke visuals layered on top. This splits "keep state" (cheap, code) from "make it stunning" (expensive, Claude).

| Tier | What it is | Made by | Time | Shown as |
| --- | --- | --- | --- | --- |
| 0. Live HUD | Isometric holographic scene of the whole architecture | My react-three-fiber renderer reading the scene model | Under 1 s | The main stage |
| 1. Library figure | A pre-built Anatomy figure for a known concept (queue, cache, mutex, DNS, TCP) | `anatomy-figures` package, dark theme, cyan accent token | Instant | Pop-up panel beside the component |
| 2. Bespoke visual | A custom interactive illustration of one component or idea | Claude writes a self-contained component, run in a sandboxed iframe | 1 to 5 min | Pop-up panel, saved with the version |
| 3. Deep render | A full Anatomy machine for a concept I want to keep | Anatomy skill run headless in Claude Code, queued | 30 min to hours | Gallery, linked from the spec |

**Live HUD look.** Orthographic camera at the isometric angle, dark background, components as translucent extruded shapes with glowing cyan edges, grouped on floating platforms per domain. Edges are light conduits; async edges pulse. A bloom pass gives the glow. The focused component brightens; everything else dims slightly.

**When to escalate.** Claude queues a Tier 2 render when a component gains internal structure worth seeing ("how does the retry worker actually back off?"). Tier 3 only runs when I say "keep this one". Tier 1 is matched automatically from the component kind and a keyword list.

**Walkthrough on arrival.** When a render lands, the voice loop gets a short event ("render ready: retry worker") and offers to walk me through it at the next pause.

## Simulation engine

Simulations run in the browser as a discrete-event model over the scene graph, using the behaviour numbers on each component; Claude only sets up the scenario and narrates the result. The same engine drives all three modes.

| Mode | I say something like | What runs | What I see |
| --- | --- | --- | --- |
| Flow | "Walk a publish request through it" | One request traced along the edges, sync and async branches | A glowing packet moving through the HUD, per-hop latency ticking up |
| Failure and load | "What happens at 500 rps if the compile service is slow?" | Arrival rate ramped, one component degraded, queues and retries modelled | Components heating from cyan to amber to red, queue depths rising, the first thing to break flashing |
| Step-through | "Step through the release state machine" | A sequence or state machine advanced one event at a time | Arrow-key stepping, current state lit, transition named in the readout |

`run_simulation` takes a scenario (`{ mode, entry, rps?, durationS?, faults?: [{ component, mode, factor }] }`) and returns a result summary (end-to-end latency, throughput, the bottleneck, failed requests). Claude speaks the summary and logs anything that changes the design as a decision.

The numbers are illustrative, not capacity planning: they show where pressure goes, not exact limits. The HUD says so in the readout.

## Context modes

Each session starts in one of two modes, chosen with a toggle before the first turn and shown in the HUD corner.

**Blank slate.** Claude has no tools beyond the scene tools. Good for greenfield ideas and for keeping sessions fast.

**Grounded.** The server adds read-only MCP servers to the Claude API call so Claude can look at real structure: the repo search and GraphQL schema servers I already have connected. Claude can seed the scene from what exists ("load the publish flow as it is today") and then we design the change on top.

Grounded mode follows one hard rule: it reads code, schemas, and system structure only, never live data, logs or records that could contain customer PII. In practice:

- An explicit allowlist of MCP servers and tools in server config; anything not listed is never passed to the API.
- No data-query, log or ticket tools in the allowlist.
- The system prompt tells Claude to describe types and fields, never example values.
- Scene snapshots and the spec doc store only what the scene model holds, so nothing fetched raw is persisted.

## Spec doc output

At the end of a session, saying "write it up" generates a Markdown spec from the final scene, the decision log and the version snapshots, saved to a local sessions folder.

The generated spec has a fixed outline:

1. Summary: what the feature does, in three sentences.
2. Architecture: a PNG of the final HUD, plus a Mermaid diagram generated from the scene graph so it stays editable.
3. Components: one short entry per component with its responsibility, interfaces and behaviour numbers.
4. Flows: the simulated flows with their latency and the bottleneck found.
5. Decisions: the decision log as a table, newest first.
6. Open questions: anything still unresolved.
7. Evolution: three to five key snapshots showing how the design changed, each with one line on why.

Each session folder also keeps `scene.vN.json` for every version, so any session can be reopened and replayed. Exporting to Confluence or Jira can come later through the Atlassian MCP.

## Skills and tools

One new skill does most of the work: `jarvis-scene`, which teaches Claude the scene model, the patch tools, the visual language and when to escalate a render. Everything else is reused.

| Piece | Role in JARVIS | Status |
| --- | --- | --- |
| `jarvis-scene` (new skill) | Scene schema, patch rules, speaking style, escalation rules, Tier 2 component conventions | Build, using skill-creator |
| [Anatomy](https://skills.wheresryan.sh/anatomy) skill | Tier 3 deep renders, run headless in Claude Code | Use as is |
| `anatomy-figures` package | Tier 1 library figures, restyled with dark theme and cyan accent | Use as is |
| frontend-design skill | Design direction for the HUD shell and panels | Use while building |
| skill-creator skill | Write and test `jarvis-scene` with evals | Use while building |
| Repo Search and GraphQL schema MCP servers | Grounded mode, read-only allowlist | Already connected |
| Atlassian MCP | Later: push the spec to Confluence or tickets to Jira | Phase 4 |
| Excalidraw or Eraser MCP | Optional: export the scene as an editable 2D diagram | Nice to have |

Sources: [Anatomy skill page](https://skills.wheresryan.sh/anatomy), read 12 October 2026.

## V1 thin slice and build phases

V1 is a thin slice of every layer: voice, live scene, one simulation, renders and the spec, each shallow but working end to end. Grounded mode and the heavier simulations wait until the loop feels right.

&#91;embedded content: build phases · 3 phases to V1, then depth\]

Each phase ends at a gate I can test by hand; Phase 4 starts only after one real feature has gone from voice to spec.

## Open questions and risks

- [ ] Which Claude model per job: a fast model for the voice turn, a stronger one for Tier 2 renders?
- [ ] Can the Anatomy skill run through the API's skills support, or does Tier 3 need a local Claude Code process?
- [ ] Layout: how do I auto-place 20+ components on the isometric grid without overlaps as the scene grows?
- [ ] Does browser speech recognition handle architecture vocabulary (idempotency, saga, DLQ) well enough?
- [ ] Cost ceiling per session, and a visible meter in the HUD?

**Risks**

- **Scene drift.** If Claude's patches pile up badly, the scene gets messy. Mitigation: validate every patch, and add a "tidy the scene" command that re-lays it out.
- **Glow over clarity.** A holographic look can bury the structure. Mitigation: a toggle to a flat, high-contrast mode, and keep the one-lit-part rule.
- **Sandboxing Tier 2.** Claude-written components run in a sandboxed iframe with no network access and no access to the parent page.
- **Fake precision.** Simulation numbers look authoritative. Mitigation: label every readout as illustrative.
