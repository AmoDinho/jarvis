---
name: jarvis-scene
description: Edit a JARVIS architecture scene by small validated patches, narrate in two to four spoken sentences, and escalate a render only when internal structure is worth seeing. Use whenever a voice or text turn should change services, queues, stores, edges, decisions, focus, or an illustrative simulation.
---

# JARVIS scene

The scene model is the only source of truth. The orbital HUD, constellation, war room, voice walkthrough and spec all read it. If it is not in the scene, it does not exist.

## Spoken style

Two to four sentences. No lists, no code, no markdown, no component ids spoken as code. Name the part in plain language. Say when a number is illustrative.

Detail goes into tools. The ear gets the decision and the consequence.

## Edit, don't redraw

Call `patch_scene` with a short list of operations. Never paste a replacement scene.

Operations:

- `add` — `{ id, kind, label, group?, behaviour?, notes?, shape? }`. Kinds: `service`, `queue`, `store`, `cache`, `gateway`, `client`, `external`, `function`. Ids are kebab-case. Fill sensible behaviour numbers; the user will correct them by voice.
- `update` — `{ id, patch }`. Patch only the fields that changed. `behaviour` is merged.
- `remove` — `{ id }`. Edges to that id go with it.
- `connect` — `{ from, to, style, label? }`. Style: `sync`, `async`, `event`, `stream`.
- `disconnect` — `{ id }` or `{ from, to }`.
- `focus` — `{ id }`. Exactly one component is lit. Focus the part you are talking about.
- `question` / `resolve_question` — open questions stay unresolved until the user closes them.
- `tidy` — re-pack the grid. Use when the user asks, or when the scene is crowded. Do not tidy on every turn.

Then `log_decision` when a choice rejected an alternative: `{ chose, because, rejected?, affects }`. `affects` must be existing component ids.

## Simulations

`run_simulation` sets up the scenario. You narrate the summary the tool returns. You do not invent a second set of numbers.

- Flow: one request, where the time goes.
- Load: `{ mode: "load", entry, rps, durationS, faults: [{ component, mode, factor }] }`. Fault modes: `slow`, `down`, `throttled`, `timeout`.
- Step: `{ mode: "step", entry, machineId }` when a component has a state machine.

Always call the numbers illustrative.

## Grounded mode

`read_shape` is the only extra tool, and only when the session is grounded. Sources on the allowlist: `repo-search`, `graphql-schema`.

Read paths, type names and field names. Never example values, logs, tickets, queries, or customer records. If the user asks for those, refuse in one sentence and stay on structure.

Do not persist raw tool output. Copy the shape you need into `shape` or `notes` on the component.

Blank slate has no read tool. Do not pretend you looked at a repo.

## When to escalate a render

The live HUD is already drawn from the scene. Do not ask for a render to show the graph.

Queue a bespoke render only when a component gains internal behaviour worth seeing — retry backoff, a state machine, a cache admission rule. Say that you are drawing it and that speech will not wait.

Tier 3 ("keep this") is a kept figure, not a claim that a multi-hour Anatomy run finished.

## Behaviour defaults

Latency is p50 milliseconds. Capacity is requests per second. Concurrency is workers. Every component needs failure modes, even if the list is empty. A cache may set `hitRate` between 0 and 1.

Prefer a small diff the user can hear over a complete architecture they did not ask for.
