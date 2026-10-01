# kit

Small, dependency-free libraries for talking to a workflow service over HTTP:
request signing, a client, a callback handler, and a few helpers around them.
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
| `@zavon/workflow-graph`  | A decision-tree compiler: validate a graph, compile it to steps, decompile steps to a graph. |

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
cd ts && npm test
```

## Licence

Copyright © Zavon Holdings (Pty) Ltd. All rights reserved. No licence is granted to use,
copy, modify or distribute this code.
