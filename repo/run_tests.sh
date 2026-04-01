#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

COMPOSE="docker compose -f docker-compose.test.yml"

cleanup() {
  echo ""
  echo "=== Tearing down test containers ==="
  $COMPOSE down --volumes --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Building test image ==="
$COMPOSE build --progress=plain

echo ""
echo "=== Running all tests (backend + frontend) ==="
$COMPOSE run --rm test-runner

echo ""
echo "=== All tests passed ==="
