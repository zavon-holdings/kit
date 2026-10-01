#!/usr/bin/env bash
# bump.sh vX.Y.Z <app-dir…> [--push]
#
# Moves each consumer onto one kit release, one commit per app, straight to
# main (the estate's rule). For every app directory:
#   1. `go get github.com/zavon-holdings/kit/go@vX.Y.Z` in its backend/
#   2. vendors it — `go work vendor` when the repository has a go.work at its
#      root (a go.work makes `go build` ignore a vendor/ made by `go mod
#      vendor`, and the build then fails "inconsistent vendoring"), otherwise
#      `go mod vendor` in backend/
#   3. writes KIT_VERSION at the repository root
#   4. runs the backend's tests
#   5. commits "Kit vX.Y.Z" with the vendored bytes
# Nothing is pushed unless --push is given.
#
# Kit is public (2026-10-01), so the fetch needs no credential. It still
# happens here — on a developer's machine or in this script's CI — and never
# in a consumer's build: a consumer builds from its committed vendor/.
set -euo pipefail

usage() { sed -n '2,20p' "$0"; exit 2; }
[ $# -ge 2 ] || usage
VERSION="$1"; shift
case "$VERSION" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "!! version must look like vX.Y.Z" >&2; exit 2 ;; esac

PUSH=0
APPS=()
for a in "$@"; do
  if [ "$a" = "--push" ]; then PUSH=1; else APPS+=("$a"); fi
done
[ ${#APPS[@]} -gt 0 ] || usage

export GOPRIVATE="${GOPRIVATE:-github.com/zavon-holdings/*}"
failed=0
for app in "${APPS[@]}"; do
  root="$(cd "$app" && git rev-parse --show-toplevel)"
  echo "── $root"
  if [ -n "$(git -C "$root" status --porcelain)" ]; then
    echo "!! $root has uncommitted changes; skipped" >&2; failed=1; continue
  fi
  backend="$root/backend"
  [ -f "$backend/go.mod" ] || { echo "!! no backend/go.mod in $root; skipped" >&2; failed=1; continue; }
  (cd "$backend" && go get "github.com/zavon-holdings/kit/go@$VERSION" && go mod tidy)
  if [ -f "$root/go.work" ]; then
    (cd "$root" && go work vendor)
  else
    (cd "$backend" && go mod vendor)
  fi
  printf '%s\n' "$VERSION" > "$root/KIT_VERSION"
  if ! (cd "$backend" && go test ./...); then
    echo "!! tests failed in $root; nothing committed" >&2; failed=1; continue
  fi
  git -C "$root" add -A
  git -C "$root" commit -m "Kit $VERSION" -m "Vendored github.com/zavon-holdings/kit/go@$VERSION by kit/scripts/bump.sh."
  if [ "$PUSH" = 1 ]; then
    git -C "$root" push origin HEAD:main
  fi
done
exit $failed
