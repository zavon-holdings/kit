# kit

Small libraries for talking to a workflow service over HTTP: request signing,
a client, a callback handler, and a few helpers around them — dependency-free,
bar the one React editor below.
Each library is held to a set of JSON contract vectors so that the Go and
TypeScript twins, and any server that implements the same wire, agree byte for
byte.

## Go (`go/`, module `github.com/zavon-holdings/kit/go`)

| Package      | What it is |
|--------------|------------|
| `webhooksig` | Sign and verify the `X-Zavon-Signature` / `X-Zavon-Timestamp` HMAC-SHA256 request signature, with secret rotation. Fails closed. |
| `policy`     | A statement evaluator: allow/deny statements over `<app>:<type>:<verb>` actions and `org/<slug>/…` resources. Deny beats allow; default deny. |
| `wfclient`   | A client for the workflow API (`/api/workflows/*`): definitions (with the graph drawn beside the steps, the migration map and interrupts), validate and simulate, runs, events, tasks, manifest, deliveries, and an organisation's calendar. Errors carry the server's code. |
| `wfhandler`  | A callback endpoint for an app: verifies the signature, dedupes on `Idempotency-Key`, and shapes the answer. `DoorTx` writes the replay record in the handler's own transaction. |
| `outbox`     | An at-least-once outbox: rows added in the caller's transaction, drained later with backoff. |
| `permits`    | A versioned cache of who holds what in an organisation, with an HTTP refresher and a `Decide` over `policy`. |
| `merge3`     | A three-way merge of ordered trees of keyed units (a document's blocks, an outline's sections): fields, deletions, moves and order, with conflicts and `Resolve`. Twin of `@zavon/merge3`. |
| `aiclient`   | A client for an AI gateway's property routes: invoke a tool, start and read a job, the status a screen renders, feedback, and an organisation's AI settings. The credential is read on every request. |

Database access goes through a small `Querier` interface (`Exec`, `QueryRow`)
that a pgx pool or transaction satisfies; kit imports no driver. JSONB values
are passed as strings.

## TypeScript (`ts/`, npm workspace)

| Package                  | What it is |
|--------------------------|------------|
| `@zavon/webhooksig`      | The signature, for Node and the browser. Twin of `go/webhooksig`. |
| `@zavon/conditions`      | The workflow condition language: parse, evaluate, describe, fields. |
| `@zavon/workflow-graph`  | A decision-tree compiler: validate a graph, compile it to steps, decompile steps to a graph. Draws decisions, forks, loops, approvals, sub-workflows, payment requests and invoices (each one node, compiled to a sequence), and carries canvas notes that never compile. |
| `@zavon/workflow-ui`     | A React editor for those graphs: canvas, an accessible List twin, palette, inspector, Problems, Steps and Simulate panels. |
| `@zavon/merge3`          | The three-way tree merge, for Node and the browser. Twin of `go/merge3`. |
| `@zavon/tour`            | A spotlight tour for React: the page dimmed around one element, a tooltip with a link to further reading, next, back and skip. Tours as data; progress through a storage adapter — this browser, or a server with an offline queue (1.1) — and What's new. |
| `@zavon/assistant`       | AI assistance controls for React: the gateway's wire types, a status hook, a button that shows a tool's credit price or why it is not available, a side sheet for help answers and proposals, a before and after view, and feedback thumbs. Every word comes from the host. |

### `@zavon/workflow-ui`

Controlled: the host holds the graph and saves it; the editor proposes the
next graph through `onChange`. It holds no fetch code — the host passes an
`api` (`validate`, `simulate`) routed through its own backend, and its own
inspectors per node type. `readOnly` draws a graph without editing it.

```tsx
import "@xyflow/react/dist/base.css";
import "@zavon/workflow-ui/styles.css";
import { WorkflowBuilder } from "@zavon/workflow-ui";

<WorkflowBuilder graph={graph} onChange={setGraph} trigger="event" api={api} inspectors={inspectors} />
```

Beyond drawing, the editor carries what a person needs to build a tree with
confidence, each piece also exported on its own:

- **Undo and redo** (`history`): whole graphs, typing coalesced into one step.
- **Copy and paste** of nodes and whole sub-trees (`clipboard`), through the
  system clipboard as a `workflow.fragment/1` document: fresh ids, the
  fragment's own `steps.<id>` references followed.
- **Several nodes at once** (Shift-click, Shift-drag a box, Mod+A): move,
  align, space evenly, copy, remove (`arrange`); snap to a grid.
- **Find** a node by name, id, type or settings (`search`); an overview map;
  a **keyboard shortcuts** sheet read from the same table as the key handler
  (`shortcuts`); every problem links to its node.
- **Export and import**: the graph as JSON, a picture as SVG or PNG drawn
  from the canvas's own positions and lanes, and a printed page (`exporting`).
- **The trigger** on the start node (`TriggerPanel`: by hand, an event with a
  filter in the condition language, a schedule, a date, an app) and
  definition-level **interrupts** (`InterruptsPanel`), when the host hands
  them in; the definition, not the graph, holds both.
- **Simulate** several samples side by side; keep a walk as a named
  **scenario** and run them all as a regression check (`ScenariosPanel`,
  `checkScenario`).
- **Who a task goes to** for the sample, asked of the host
  (`api.previewAssignees`).
- **Versions compared** (`VersionDiff`, `diffGraphs`, `diffSteps`): two
  drawings side by side with what changed marked, and the steps aligned by
  code. `GraphView` draws any graph read only.
- **Starters** (`STARTERS`): small trees that compile as they stand.
- **Every node type the compiler draws**, with a built-in inspector where a
  host has none: loops (`body` and `next`), approvals, sub-workflows, and
  the money nodes (payment request, invoice) whose ways out are their
  outcomes; **notes** on the canvas, presentation only like the layout.

The `api` is optional member by member (`validate`, `simulate`,
`previewAssignees`, `listScenarios`, `saveScenario`, `deleteScenario`,
`runScenarios`); a panel whose call is missing says so.

- Peers: `react`, `react-dom`, `@zavon/workflow-graph`, `@zavon/conditions`
  (install all three kit packs). Depends on `@xyflow/react` (MIT), which
  brings `@xyflow/system`, `zustand`, `classcat` (MIT) and the `d3-*` modules
  it uses (ISC, `d3-ease` BSD-3-Clause), all from npm and bundled by the host.
- **The look** (1.9): node cards coloured by category (Logic, People and
  approvals, Messages, Money, Timing, Apps and integrations; start and end)
  with an icon chip, the name and one line that says who, when or what
  (`summarize`); the start a pill and each end an outcome badge toned by
  its outcome; edges curved, their outcome labels toned by meaning
  (`outcomeTone`: approved and yes ok, rejected and no danger, timeout,
  expired and overdue warn), flowing on hover and along a simulated path; a
  palette of described cards with search, clicked or dragged onto the
  canvas; a sectioned inspector; icon buttons with tooltips, zoom, a
  readable Fit (`fitView`) and an overview map; an empty canvas that offers
  the first step. The first view (`readableView`) fits a tall tree to its
  width at a readable size from the top; far out, a card drops its details
  and its name grows. A lane's label sits clear of the cards it passes.
- **Confirmation cards** (`ConfirmDialog`, a modal alertdialog with the
  impact listed, exported for a host's own publish, go-live or discard).
  Removing a step with everything only it reaches (`branchOf`) always asks;
  `confirmRemovals` makes every removal ask. Otherwise a removal is at once
  and offers Restore, and Undo always brings it back.
- No typography of its own; colours are `--zwf-*` CSS variables a host sets
  on any element around the editor — the base set, `--zwf-on-accent`,
  `--zwf-cat-{logic,people,messages,money,timing,apps,structure}`,
  `--zwf-shadow-{sm,md,lg}`, `--zwf-backdrop`, and optionally
  `--zwf-edge[-ok|-danger|-warn]`, `--zwf-grid`, `--zwf-canvas-ground`.
  Tints are worked out from them, so a dark host sets the same variables
  darker. Status is tint, dot and words. The
  editor's headings start at `headingLevel` (2 unless the host says), so
  they follow the host page's own outline.
- Every canvas edit is possible in the List tab with ordinary controls;
  nodes are one tab stop (arrows move along edges), edges connect by menu,
  zoom has buttons, and `prefers-reduced-motion` turns off animated pans.
  Axe runs over every editor state in the package's tests.
- Built with `tsc` into `dist/` when packed; `npm test` typechecks and runs
  vitest with testing-library.

### `@zavon/merge3` and `go/merge3`

A three-way merge for documents two people edited from the same version. A
tree is units — `{ key, kind, fields: { path: value }, slots: { name:
[unit] } }` — and the merge takes the common ancestor and both edits:

```ts
import { merge3 } from "@zavon/merge3";

const result = merge3(base, mine, theirs);   // { tree, conflicts, resolve }
const done = result.resolve({ "field:p1:text": { choice: "b" } });
```

```go
r, err := merge3.Merge(base, mine, theirs)
res, err := r.Resolve(map[string]merge3.Decision{"field:p1:text": {Choice: "b"}}, merge3.Options{})
```

- **Matching** is by key. A unit with no key is matched to one under the
  same parent and slot by identical content, then by a longest common
  subsequence of kinds. Keys beginning with `~` are reserved: the root is
  `~`, and a keyless unit is named `~parent/slot/…` in conflicts.
- **Fields** merge one path at a time (one side unchanged takes the other;
  both the same takes it); otherwise a `field` conflict, tentatively A. The
  kind merges as the field `@kind`.
- **Deletion**: a unit deleted on one side and untouched on the other goes.
  Deleted on one side and changed on the other — its fields, its place, or
  anything beneath it — is a `delete` conflict, tentatively kept; its
  children follow it.
- **Moves**: a unit's place merges like a field (`@parent`); two different
  moves, or moves that together would make a unit its own ancestor, are a
  `move` conflict, tentatively A.
- **Order** merges per slot over the units all three versions kept there:
  one side's reorder wins; two different reorders are an `order` conflict,
  tentatively A. Additions go after their nearest surviving earlier sibling,
  A's before B's.
- **Resolving**: per conflict `a`, `b`, `manual` (with a value: the field's
  value, a boolean for a delete, `{parent, slot}` for a move, the keys for
  an order) or `both`. `both` keeps a deleted unit, keeps a moved unit in A's
  place and a copy in B's, and — only with `duplicateAsUnits` — keeps a unit
  whose field conflicts twice, A's then a copy with B's. A copy and
  everything in it get fresh keys (`mintKey`, default `key~b`), reported in
  `ids`. An order has no `both`. The tree is valid (`validate`) for every
  combination of decisions.
- Conflict ids are stable — `field:<key>:<path>`, `delete:<key>`,
  `move:<key>`, `order:<parent>:<slot>` — so a host can keep a decision
  while the people editing keep going.
- No dependencies; the TypeScript twin carries its own SHA-256 so it runs
  in the browser. Property tests (Go fuzz targets, seeded random documents
  in TypeScript) hold: one side unchanged gives the other; the same edit on
  both gives that edit; conflicts are the same either way round; disjoint
  edits merge losslessly; nothing either side kept is lost.

### `@zavon/tour`

Tours are data: an id, an optional `version`, and steps of `{ id, target,
title, body, docsUrl?, learnLabel?, placement? }`. A step's `target` is the
value of a `data-tour` attribute on the host's page — never a free CSS
selector — so a host test can read every target with `targetsOf(tours)` and
check its own source still renders each one; `docsUrlsOf` does the same for
the links, and `validateTour` names anything malformed.

```tsx
import "@zavon/tour/styles.css";
import { TourProvider, useTours, createServerTourStore } from "@zavon/tour";

<TourProvider
  tours={tours}
  person={user?.sub}             // a stable account id; nothing starts until it is known
  scope="my-app"                 // records are per person, per product
  autoStart="first-run"          // starts once, on the first visit
  docsBase="https://example.org/docs"
  store={createServerTourStore({ fetch: authedFetch, endpoint: "https://id.example.org/api/me", app: "my-app" })}
>
  {app}
</TourProvider>

const { start, restart } = useTours();   // Help menu: start("first-run"), "Restart tour": restart("first-run")
```

- **On screen** (`Spotlight`): the page dimmed with a cut-out around the
  target and the tooltip beside it on whichever side fits; a step with no
  target sits in the middle. At 640px and below the tooltip is a sheet along
  the bottom. A step whose target is not on the page is skipped and not
  counted; a tour with nothing to point at waits briefly, then closes as
  `unavailable`, which is not recorded as seen.
- **Never traps**: Escape, "Skip tour" and the close button end it from any
  step; a click on the dimmed page does nothing. The tooltip is a modal
  dialog named by its title and described by its body; focus moves into it on
  every step, Tab stays inside it, and focus returns where it was. Arrow keys
  step; a live region says "Step 2 of 5". The docs link opens in a new tab and
  says so. `prefers-reduced-motion` turns off every transition and smooth
  scroll.
- **Seen state** through a `TourStore` (`get`, `set` of a `TourRecord`):
  `localStorageStore` (never throws), `memoryStore`, and `fallbackStore`
  (a host's server first, the device's copy when it fails). A record from an
  older `version`, or one that is not finished, counts as not seen.
- **Progress on a server** (1.1, `createServerTourStore({ fetch, endpoint,
  app, legacy? })`): the host's `fetch` (it adds and renews the credential)
  and an address; the package names no service. Reads ask the server once
  per person and fall back to this browser's copy; writes go to the copy at
  once and to the server through a queue in localStorage, retried with
  backoff, flushed with `keepalive` when the page is hidden and when the
  browser comes back online; a 400/403/404 is dropped, a 401/429/5xx waits.
  Everything local is filed under the person (the host's account id, never
  an address), and only the person named last is ever sent, so two people
  on one browser never share an answer or a queue. `legacy: { prefix, scope,
  person }` sends a pre-1.1 host's localStorage records up once, with their
  dates, so nobody who finished a tour sees it again. Wire:
  `GET {endpoint}/tours?app=`, `PUT|DELETE {endpoint}/tours/{app}/{tour}`,
  `POST {endpoint}/tours/{app}/events` (batches of 50, each event with a
  client id; writes carry the reset count they were made under as `gen`).
- **Step events** (1.1): the provider tells a store's optional `event` each
  step `shown`, `next` or `back` (the step the button was pressed on),
  `completed` and `skipped`; `get`/`set` receive `{ tour, version, person,
  scope }`. `useTours().restart(id)` is "Restart tour": the store's optional
  `reset` forgets the record (on the server too), then the tour starts.
- **What's new** (1.1): `createAnnouncementsClient({ fetch, endpoint, app,
  mainTour })` lists a person's notes (`GET {endpoint}/announcements`) and
  posts receipts (`shown`, `toasted`, `opened`, `tour_started`,
  `tour_completed`, `dismissed`); the server decides who sees what.
  `useWhatsNew` is the state a Help menu draws: items, the `unseen` badge,
  `markShown`, `dismiss`, `opened`, `showMe` (the tour to start),
  `tourClosed` (records a "Show me" tour's last step), and `toast` — at most
  one big-ticket note a day across products (`toastCandidate`). Provide it
  once per page with `WhatsNewContext`. The drawing is the host's.
- No typography of its own; colours, radius and z-index are `--ztour-*` CSS
  variables. Every label is a prop (`labels`). Axe runs over the tooltip in
  the package's tests.
- Peers: `react`, `react-dom`. No other dependencies.

### `@zavon/assistant`

The wire types mirror `go/aiclient` and `contract/ai` field for field
(`AiStatus`, `AiToolStatus`, `AiJob`, `AiInvokeResult`, `AiFeedback`,
`AiError` and the rest). The package holds no address and names no product:
the host passes `load`, `ask` and `onApply`, routed through its own backend,
and every visible string through `copy`, with neutral English defaults.

```tsx
import "@zavon/assistant/styles.css";
import { useAiStatus, AiAction, AssistantSheet, ProposalDiff } from "@zavon/assistant";

const { status, refresh } = useAiStatus({ load: () => api.aiStatus() });

<AiAction status={status} toolKey="docs.section" onRun={run} copy={{ label: "Write a section" }} data-tour="ai-section" />

<AssistantSheet
  open={open}
  onClose={close}
  ask={(question) => api.askDocs(question)}
  onFeedback={(choice, answer) => api.feedback(answer.usage_event_id, choice)}
  proposal={<ProposalDiff before={blocks} after={proposed} />}
  onApply={apply}
/>
```

- The UI rule follows the status. When AI is not configured, off or
  blocked, or the status does not list the tool, `AiAction` renders nothing.
  For no permission or no credits (or a tool that is not allowed), it is a
  disabled button with an info tip that gives the reason. When ready, it
  shows the tool's price. `isShown` and `toolState` give the same answer to
  a host's own controls.
- Prices come only from the status: `priceLabel` writes a fixed price, "Up
  to" the hold of a metered tool, and "Free"; `formatCredits` writes a
  number of credits to one decimal place. A guard test fails on a credit
  price or a product name in the package's source.
- `useAiStatus({ load, refreshMs })` returns `{ status, loading, error,
  refresh }`. A failed or malformed load gives a null status, so the
  controls hide; it never throws into render.
- `AssistantSheet` is a modal side sheet: focus moves in, Tab stays inside,
  Escape closes it and focus goes back. At 640px and below it fills the
  screen. Answers show their sources as links that open in a new tab. A
  proposal is applied only after Apply and then Confirm. `FeedbackThumbs`
  sends a rating once per choice, with an optional comment of at most 500
  characters.
- `ProposalDiff` compares a list of blocks or a set of plain fields and
  marks each item Added, Removed or Changed in words; `diffItems` and
  `diffFields` do the same without drawing.
- No typography of its own; colours, radius and z-index are `--zai-*` CSS
  variables. `prefers-reduced-motion` turns off the sheet's motion. Axe runs
  over every component in the package's tests.
- Peers: `react`, `react-dom`. No other dependencies.

## Contract vectors (`contract/`)

JSON files every implementation's tests replay: `signature/`, `callback/`,
`events/`, `runs/`, `errors/`, `tasks/`, `permits/`, `conditions/`, `graph/`, `forms/`, `merge3/`, `stepgates/`, `ai/`.
`forms/` holds form definitions (valid, or refused at a page and question),
which pages and questions a respondent sees for given answers, and what a
submit keeps. A vector changing is a wire change. The `signature/`, `callback/`, `events/`,
`runs/` and `errors/` vectors are written by kit's own Go tests
(`KIT_WRITE_VECTORS=1 go test ./webhooksig ./wfclient ./wfhandler -run
TestContractVectors`), and so are `merge3/` and its random `merge3/parity/`
cases (`KIT_WRITE_VECTORS=1 go test ./merge3 -run 'TestContractVectors|TestParityCases'`);
the rest are written by the server implementation and only checked here.
`stepgates/` is written by hand: the step-requirements rule, what counts as
filled, the words a screen shows, the 422 body, the snooze grammar and the
snoozed filter. Core, Reach and Pages replay it in their Go tests and
`@zavon/step-gates` in its own.

## Releases

A tag `vX.Y.Z` runs the tests and attaches the TypeScript packs to a GitHub
release. The Go module is versioned by the matching `go/vX.Y.Z` tag. Minor
versions are additive.

**1.12.0** (no Go change; 1.11.0 is reserved; the packs are built from this release's commit):
`@zavon/step-gates` 1.0.0 — step requirements (a forward move out of a step
waits until its required fields are filled; backward and closing moves never
wait; an unknown key fails closed) and snooze (the grammar, the snoozed
filter with counts, the remembered toggle), held to `contract/stepgates`;
`@zavon/workflow-ui` 1.10.0 — "Required to move on" on every review step,
with chips from the host's catalogue (`requirementFields`), a field made in
place and a one-sentence preview. Unchanged packs keep their versions.

**1.10.0** (Go `go/v1.10.0`): `go/merge3` and `@zavon/merge3` 1.0.0 — the
three-way merge of ordered trees of keyed units, held to `contract/merge3`;
`@zavon/tour` 1.1.0 — a server store with an offline queue, step events,
`restart`, and What's new (`createAnnouncementsClient`, `useWhatsNew`).
Unchanged packs keep their versions.

## Development

```bash
cd go && gofmt -l . && go vet ./... && go test ./... -race
cd ts && npm ci && npm test
```

## Licence

Copyright © Zavon Holdings (Pty) Ltd. All rights reserved. No licence is granted to use,
copy, modify or distribute this code.
