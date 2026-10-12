#!/usr/bin/env bash
# One cat21.space e2e lane on a regtest stack in a machine-wide slot: the SDK's
# consumer-environment stack, the SDK's fees stub, the frontend built against
# the stack and served statically, the cat21-indexer backend, the Playwright
# specs, and the net-log check. Every host port comes from the slot.
#
# CI and a local run execute the same script:
#
#   # local: takes a slot (waiting in line), runs, tears the stack down, releases
#   node frontend/node_modules/ordpool-sdk/scripts/e2e-slots.mjs run --kind consumer -- \
#     scripts/e2e-lane.sh --wallet cat21wallet --with-cat21-ord --with-ord-stock --scan real -- \
#     e2e/regtest/cat21wallet-make-offer-regtest.e2e.spec.ts
#
#   # CI: the workflow acquires the slot into GITHUB_ENV, runs this, then `down`s the slot
#
# Options:
#   --wallet cat21wallet|xverse  the wallet the specs drive; xverse first runs the
#                                SDK's onboarding, which writes the seeded profile
#   --with-cat21-ord             bring up cat21-ord: the backend syncs cats from it and
#                                the frontend's ordExplorer reads it
#   --with-ord-stock             bring up the stock ord: the frontend's ordFullExplorer
#   --scan real|stub             where cat21Config's two ord URLs point for the funding
#                                scan: the two real ords, or the fees stub's /output
#   -- <spec>...                 Playwright spec paths, relative to frontend/
#
# Environment:
#   E2E_SLOT                     required: the stack slot (from `e2e-slots.mjs run` or acquire)
#   E2E_LANE_DIR                 logs, build output, net log, Xverse profile; default .e2e-lane/
#   ELECTRS_SRC, CAT21_ORD_SRC   checkouts the compose builds electrs and the ords from
#   E2E_BUILDX_CACHE=1           CI: build the images through buildx with the gha cache
#   E2E_SDK_DIR                  ordpool-sdk checkout at the pinned sha, built, with its
#                                extensions staged (the Xverse onboarding runs there)
#   CAT21WALLET_EXT_PATH, XVERSE_EXT_PATH  the unpacked extension the specs load

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"
SDK_PKG="$FRONTEND/node_modules/ordpool-sdk"
SLOTS_CLI="$SDK_PKG/scripts/e2e-slots.mjs"

WALLET=""
WITH_CAT21_ORD=0
WITH_ORD_STOCK=0
SCAN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --wallet) WALLET="$2"; shift 2 ;;
    --with-cat21-ord) WITH_CAT21_ORD=1; shift ;;
    --with-ord-stock) WITH_ORD_STOCK=1; shift ;;
    --scan) SCAN="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "e2e-lane: unknown argument $1" >&2; exit 2 ;;
  esac
done
SPECS=( "$@" )

case "$WALLET" in cat21wallet|xverse) ;; *) echo "e2e-lane: --wallet cat21wallet|xverse is required" >&2; exit 2 ;; esac
case "$SCAN" in real|stub) ;; *) echo "e2e-lane: --scan real|stub is required" >&2; exit 2 ;; esac
if [ "$SCAN" = real ] && { [ "$WITH_CAT21_ORD" = 0 ] || [ "$WITH_ORD_STOCK" = 0 ]; }; then
  echo "e2e-lane: --scan real reads both ords; add --with-cat21-ord --with-ord-stock" >&2
  exit 2
fi
[ "${#SPECS[@]}" -gt 0 ] || { echo "e2e-lane: no spec given after --" >&2; exit 2; }
if [ -z "${E2E_SLOT:-}" ]; then
  echo "e2e-lane: E2E_SLOT is not set. Run it in a slot:" >&2
  echo "  node $SLOTS_CLI run --kind consumer -- $0 ..." >&2
  exit 2
fi

# The slot's ports and container names, keeping anything the caller already set.
eval "$(node "$SLOTS_CLI" env --slot "$E2E_SLOT" --kind consumer --format sh)"

LANE="${E2E_LANE_DIR:-$ROOT/.e2e-lane}"
rm -rf "$LANE"
mkdir -p "$LANE"
# Every wallet browser (the Xverse onboarding and the specs) writes Chrome's net
# log here through launchWalletContext; check-net-log.mjs reads it at the end.
export ORDPOOL_E2E_NET_LOG_DIR="$LANE/net-log"

url() { echo "http://localhost:$1"; }
FEES_STUB_URL="$(url "$E2E_FEES_STUB_PORT")"
APP_URL="$(url "$E2E_APP_PORT")"
APP_BACKEND_URL="$(url "$E2E_APP_BACKEND_PORT")"
ORD_URL="$(url "$E2E_ORD_HOST_PORT")"
ORD_STOCK_URL="$(url "$E2E_ORD_STOCK_HOST_PORT")"

PIDS=()
PATCHED=( "$FRONTEND/src/app/app.config.ts" "$FRONTEND/src/environments/environment.prod.ts" )

restore_sources() {
  local f
  for f in "${PATCHED[@]}"; do
    if [ -f "$LANE/patch-backup/$(basename "$f")" ]; then
      cp "$LANE/patch-backup/$(basename "$f")" "$f"
      rm "$LANE/patch-backup/$(basename "$f")"
    fi
  done
}

cleanup() {
  local pid
  restore_sources
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# Polls `$2` until it answers HTTP 200 (with `$3` as the Accept header), for at
# most `$4` seconds; on timeout prints `$5` (a log file) and fails.
wait_http() {
  local what="$1" target="$2" accept="$3" seconds="$4" log="${5:-}" code=000 i
  for i in $(seq 1 "$seconds"); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "Accept: $accept" "$target" 2>/dev/null || true)
    if [ "$code" = 200 ]; then
      echo "e2e-lane: $what up ($target)"
      return 0
    fi
    sleep 1
  done
  echo "e2e-lane: $what never answered 200 at $target (last HTTP $code)" >&2
  if [ -n "$log" ] && [ -f "$log" ]; then tail -100 "$log" >&2; fi
  return 1
}

# ── 1. The stack: bitcoind, electrs, mariadb, and the ords this lane reads ──
BOOTSTRAP_ARGS=()
[ "${E2E_BUILDX_CACHE:-0}" = 1 ] && BOOTSTRAP_ARGS+=( --buildx-cache )
[ "$WITH_CAT21_ORD" = 1 ] && BOOTSTRAP_ARGS+=( --with-cat21-ord )
[ "$WITH_ORD_STOCK" = 1 ] && BOOTSTRAP_ARGS+=( --with-ord-stock )
bash "$SDK_PKG/e2e/consumer-environment-bootstrap.sh" ${BOOTSTRAP_ARGS[@]+"${BOOTSTRAP_ARGS[@]}"} > "$LANE/stack.json"
cat "$LANE/stack.json"
if [ "$WITH_CAT21_ORD" = 1 ]; then
  wait_http cat21-ord "$ORD_URL/status" application/json 240
fi
if [ "$WITH_ORD_STOCK" = 1 ]; then
  wait_http ord-stock "$ORD_STOCK_URL/status" application/json 240
fi

# ── 2. The SDK's fees stub: fee tiers, ord /output for --scan stub, electrs proxy ──
node "$SDK_PKG/e2e/regtest/fees-electrs-stub.mjs" > "$LANE/fees-stub.log" 2>&1 &
PIDS+=( $! )
wait_http "fees stub" "$FEES_STUB_URL/healthz" '*/*' 30 "$LANE/fees-stub.log"

# ── 3. Xverse: the SDK onboards the test wallet into a profile the specs copy ──
if [ "$WALLET" = xverse ]; then
  : "${E2E_SDK_DIR:?e2e-lane: E2E_SDK_DIR must point at the ordpool-sdk checkout the Xverse onboarding runs in}"
  export XVERSE_SEED_USER_DATA_DIR="$LANE/xverse-seed/user-data-dir"
fi

run_headed() {
  # Wallet extensions need a real renderer; a display-less Linux runner gets one from xvfb.
  if [ "$(uname)" = Linux ] && [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null; then
    xvfb-run --auto-servernum --server-args='-screen 0 1280x900x24' "$@"
  else
    "$@"
  fi
}

if [ "$WALLET" = xverse ]; then
  ( cd "$E2E_SDK_DIR" && run_headed \
      ./node_modules/.bin/playwright test e2e/playwright/specs/xverse-loads.spec.ts \
      --config=e2e/playwright/playwright.config.ts ) 2>&1 | tee "$LANE/xverse-onboarding.log"
  test -d "$XVERSE_SEED_USER_DATA_DIR/Default" \
    || { echo "e2e-lane: the Xverse onboarding wrote no profile at $XVERSE_SEED_USER_DATA_DIR" >&2; exit 1; }
fi

# ── 4. The frontend, built against this stack ──
# cat21Config (app.config.ts) and the environment are compiled in, so the build
# patches them and puts them back right after; the trap restores them too.
if [ "$SCAN" = real ]; then
  SCAN_ORD="$ORD_STOCK_URL"; SCAN_CAT21_ORD="$ORD_URL"
else
  SCAN_ORD="$FEES_STUB_URL"; SCAN_CAT21_ORD="$FEES_STUB_URL"
fi
EXPLORER_ORD="$FEES_STUB_URL"; [ "$WITH_CAT21_ORD" = 1 ] && EXPLORER_ORD="$ORD_URL"
EXPLORER_FULL_ORD="$FEES_STUB_URL"; [ "$WITH_ORD_STOCK" = 1 ] && EXPLORER_FULL_ORD="$ORD_STOCK_URL"

mkdir -p "$LANE/patch-backup"
for f in "${PATCHED[@]}"; do cp "$f" "$LANE/patch-backup/$(basename "$f")"; done
perl -pi \
  -e "s|https://api\\.ordpool\\.space|$FEES_STUB_URL|g;" \
  -e "s|https://backend2\\.cat21\\.space|$APP_BACKEND_URL|g;" \
  -e "s|https://ord\\.ordpool\\.space|$SCAN_ORD|g;" \
  -e "s|https://ord\\.cat21\\.space|$SCAN_CAT21_ORD|g;" \
  -e 's|useValue: Network\.Mainnet|useValue: Network.Regtest|;' \
  "$FRONTEND/src/app/app.config.ts"
perl -pi \
  -e "s|mempoolApiUrl: 'https://api\\.ordpool\\.space'|mempoolApiUrl: ''|;" \
  -e "s|https://backend2\\.cat21\\.space|$APP_BACKEND_URL|g;" \
  -e "s|https://ord\\.cat21\\.space|$EXPLORER_ORD|g;" \
  -e "s|https://ord\\.ordpool\\.space|$EXPLORER_FULL_ORD|g;" \
  "$FRONTEND/src/environments/environment.prod.ts"
if grep -nE "'https://(api\.ordpool|backend2\.cat21|ord\.ordpool|ord\.cat21)\.space'|Network\.Mainnet" "${PATCHED[@]}"; then
  echo "e2e-lane: a production host or mainnet survived the patch (above)" >&2
  exit 1
fi
( cd "$FRONTEND" && ./node_modules/.bin/ng build --output-path "$LANE/dist" ) > "$LANE/build.log" 2>&1 \
  || { tail -200 "$LANE/build.log" >&2; exit 1; }
restore_sources

BROWSER_DIR=""
for candidate in "$LANE/dist/browser" "$LANE/dist"; do
  if [ -f "$candidate/index.html" ]; then BROWSER_DIR="$candidate"; break; fi
done
[ -n "$BROWSER_DIR" ] || { echo "e2e-lane: no index.html under $LANE/dist" >&2; exit 1; }

# ── 5. Serve it: every unknown path answers index.html, as the SPA host does ──
cat > "$LANE/spa-server.cjs" <<'EOF'
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3]);
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', txt: 'text/plain', map: 'application/json' };
http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  let f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  const ext = f.split('.').pop() ?? '';
  res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`spa-server on 127.0.0.1:${port} root=${root}`));
EOF
node "$LANE/spa-server.cjs" "$BROWSER_DIR" "$E2E_APP_PORT" > "$LANE/serve.log" 2>&1 &
PIDS+=( $! )
wait_http "static frontend" "$APP_URL/" 'text/html' 60 "$LANE/serve.log"

# ── 6. The cat21-indexer backend, syncing cats from cat21-ord (or the stub) ──
( cd "$BACKEND" && npm run build ) > "$LANE/backend-build.log" 2>&1 \
  || { tail -100 "$LANE/backend-build.log" >&2; exit 1; }
BACKEND_ORD="$FEES_STUB_URL"; [ "$WITH_CAT21_ORD" = 1 ] && BACKEND_ORD="$ORD_URL"
( cd "$BACKEND" && \
  PORT="$E2E_APP_BACKEND_PORT" \
  HOST=127.0.0.1 \
  NODE_ENV=development \
  DATABASE_URL="mysql://cat21:cat21@127.0.0.1:$E2E_MARIADB_HOST_PORT/cat21" \
  ORD_API_URL="$BACKEND_ORD" \
  ELECTRS_API_URL="$FEES_STUB_URL" \
  BACKEND_NETWORK=regtest \
  SYNC_INTERVAL_MS=2000 \
  CORS_EXTRA_ORIGINS="$APP_URL" \
  exec node dist/main.js ) > "$LANE/indexer-backend.log" 2>&1 &
PIDS+=( $! )
wait_http "indexer backend" "$APP_BACKEND_URL/api/health" 'application/json' 60 "$LANE/indexer-backend.log"

# ── 7. The specs, then the proof that nothing left the machine ──
status=0
( cd "$FRONTEND" && run_headed \
    ./node_modules/.bin/playwright test "${SPECS[@]}" --config=playwright.regtest.config.ts ) || status=$?
node "$SDK_PKG/scripts/check-net-log.mjs" "$ORDPOOL_E2E_NET_LOG_DIR" || { [ "$status" -ne 0 ] || status=1; }
exit "$status"
