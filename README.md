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
| `wfclient`   | A client for the workflow API (`/api/workflows/*`): definitions, runs, events, tasks, manifest, deliveries. Errors carry the server's code. |
| `wfhandler`  | A callback endpoint for an app: verifies the signature, dedupes on `Idempotency-Key`, and shapes the answer. `DoorTx` writes the replay record in the handler's own transaction. |
| `outbox`     | An at-least-once outbox: rows added in the caller's transaction, drained later with backoff. |
| `permits`    | A versioned cache of who holds what in an organisation, with an HTTP refresher and a `Decide` over `policy`. |

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
- No typography of its own; colours are `--zwf-*` CSS variables a host sets
  on any element around the editor. Status is tint, dot and words.
- Every canvas edit is possible in the List tab with ordinary controls;
  nodes are one tab stop (arrows move along edges), edges connect by menu,
  zoom has buttons, and `prefers-reduced-motion` turns off animated pans.
  Axe runs over every editor state in the package's tests.
- Built with `tsc` into `dist/` when packed; `npm test` typechecks and runs
  vitest with testing-library.

## Contract vectors (`contract/`)

JSON files every implementation's tests replay: `signature/`, `callback/`,
`events/`, `runs/`, `errors/`, `tasks/`, `permits/`, `conditions/`, `graph/`.
A vector changing is a wire change. The `signature/`, `callback/`, `events/`,
`runs/` and `errors/` vectors are written by kit's own Go tests
(`KIT_WRITE_VECTORS=1 go test ./webhooksig ./wfclient ./wfhandler -run
TestContractVectors`); the rest are written by the server implementation and
only checked here.

## Releases

A tag `vX.Y.Z` runs the tests and attaches the TypeScript packs to a GitHub
release. The Go module is versioned by the matching `go/vX.Y.Z` tag. Minor
versions are additive.

## Development

```bash
cd go && gofmt -l . && go vet ./... && go test ./... -race
cd ts && npm ci && npm test
```

## Licence

Copyright © Zavon Holdings (Pty) Ltd. All rights reserved. No licence is granted to use,
copy, modify or distribute this code.
