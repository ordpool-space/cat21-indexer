#!/usr/bin/env bash
# The backend regtest lane: the cat21-indexer backend's sync clients
# (OrdClientService, ElectrsClientService) against a real bitcoind, our electrs
# and cat21-ord in a machine-wide stack slot, every host port from the slot.
# Seeds one CAT-21 mint, then runs `npm run test:regtest`.
#
#   # local: takes a slot (waiting in line), runs, tears the stack down, releases
#   node backend/node_modules/ordpool-sdk/scripts/e2e-slots.mjs run --kind consumer -- scripts/backend-regtest-lane.sh
#
# Environment: E2E_SLOT (required), ELECTRS_SRC, CAT21_ORD_SRC, E2E_BUILDX_CACHE=1 (CI),
# E2E_LANE_DIR (default .e2e-lane/).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
SDK_PKG="$BACKEND/node_modules/ordpool-sdk"
SLOTS_CLI="$SDK_PKG/scripts/e2e-slots.mjs"

if [ -z "${E2E_SLOT:-}" ]; then
  echo "backend-regtest-lane: E2E_SLOT is not set. Run it in a slot:" >&2
  echo "  node $SLOTS_CLI run --kind consumer -- $0" >&2
  exit 2
fi
eval "$(node "$SLOTS_CLI" env --slot "$E2E_SLOT" --kind consumer --format sh)"

LANE="${E2E_LANE_DIR:-$ROOT/.e2e-lane}"
rm -rf "$LANE"
mkdir -p "$LANE"
ORD_URL="http://localhost:$E2E_ORD_HOST_PORT"
ELECTRS_URL="http://localhost:$E2E_ELECTRS_HOST_PORT"

BOOTSTRAP_ARGS=( --with-cat21-ord )
[ "${E2E_BUILDX_CACHE:-0}" = 1 ] && BOOTSTRAP_ARGS+=( --buildx-cache )
bash "$SDK_PKG/e2e/consumer-environment-bootstrap.sh" "${BOOTSTRAP_ARGS[@]}" > "$LANE/stack.json"
cat "$LANE/stack.json"

for i in $(seq 1 240); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: application/json' "$ORD_URL/status" 2>/dev/null || true)
  if [ "$code" = 200 ]; then echo "cat21-ord up"; break; fi
  if [ "$i" = 240 ]; then echo "cat21-ord never came up (last HTTP $code)" >&2; exit 1; fi
  sleep 1
done

# The specs need a real CAT-21 cat on-chain: the ord-client spec discovers the
# latest cat and its outpoint; the electrs spec reads the mint's fresh
# (unspent) cat output AND the (spent) funding input it consumed. Seed exactly
# one mint so both prove against real infra.
bcli() { docker exec "$REGTEST_BITCOIND_CONTAINER" bitcoin-cli -regtest -rpcuser=ordpool -rpcpassword=ordpool "$@"; }
# A dedicated funding wallet, created here (idempotent create-or-load).
wcli() { bcli -rpcwallet=seed "$@"; }
bcli -named createwallet wallet_name=seed load_on_startup=true >/dev/null 2>&1 \
  || bcli loadwallet seed >/dev/null 2>&1 || true

SEED_ADDR=$(wcli getnewaddress)
# Mine 101 blocks to the seed wallet so its coinbase matures.
# generatetoaddress is a node RPC (no -rpcwallet needed).
bcli generatetoaddress 101 "$SEED_ADDR" >/dev/null

# Baseline cat count before the mint (fresh chain: 0). cat21-ord serves HTML
# unless asked for JSON, so the Accept header is load-bearing: without it /cats
# returns an HTML page, jq fails, and the count silently reads 0 forever.
BEFORE=$(curl -s -H 'Accept: application/json' "$ORD_URL/cats" | jq '.ids | length' 2>/dev/null || echo 0)
echo "cat count before seed: $BEFORE"

# Build the mint as an EXPLICIT-input createrawtransaction with locktime=21.
# fundrawtransaction and the `send` RPC apply anti-fee-sniping and OVERRIDE the
# locktime; createrawtransaction writes exactly the locktime it is given, and
# signrawtransactionwithwallet preserves it. cat21-ord indexes a tx as a cat IFF
# nLockTime==21 (inscription_updater.rs: `tx.lock_time.to_consensus_u32() == 21`).
# One mature coinbase UTXO pays a 0.001 BTC cat output + change (fee 0.0001 BTC),
# in satoshis to avoid float rounding.
SEL=$(wcli listunspent 100 9999999 '[]' true '{"minimumAmount":1}' | jq -c '.[0]')
UTXO_TXID=$(echo "$SEL" | jq -r '.txid')
UTXO_VOUT=$(echo "$SEL" | jq -r '.vout')
UTXO_SAT=$(echo "$SEL" | jq -r '(.amount * 100000000) | round')
CHANGE_SAT=$((UTXO_SAT - 100000 - 10000))
CHANGE_BTC=$(printf '%d.%08d' $((CHANGE_SAT / 100000000)) $((CHANGE_SAT % 100000000)))
DEST=$(wcli getnewaddress)
CHANGE=$(wcli getnewaddress)
INPUTS=$(jq -nc --arg t "$UTXO_TXID" --argjson v "$UTXO_VOUT" '[{txid:$t,vout:$v}]')
OUTPUTS=$(jq -nc --arg d "$DEST" --arg c "$CHANGE" --arg cha "$CHANGE_BTC" '[{($d):0.001},{($c):($cha|tonumber)}]')
RAW=$(bcli createrawtransaction "$INPUTS" "$OUTPUTS" 21)
SIGNED=$(wcli signrawtransactionwithwallet "$RAW" | jq -r '.hex')
TXID=$(bcli sendrawtransaction "$SIGNED")
echo "seed mint txid: $TXID"
# nLockTime==21 on-chain BEFORE depending on indexing: a wrong locktime fails
# here instead of as an index timeout.
LT=$(bcli getrawtransaction "$TXID" true | jq -r '.locktime')
if [ "$LT" != 21 ]; then
  echo "seed tx locktime=$LT, not 21: cat21-ord will not index it as a cat" >&2
  exit 1
fi
bcli generatetoaddress 1 "$SEED_ADDR" >/dev/null

for i in $(seq 1 120); do
  COUNT=$(curl -s -H 'Accept: application/json' "$ORD_URL/cats" | jq '.ids | length' 2>/dev/null || echo 0)
  if [ "${COUNT:-0}" -gt "${BEFORE:-0}" ]; then echo "cat21-ord indexed the seed cat (count $BEFORE -> $COUNT)"; break; fi
  if [ "$i" = 120 ]; then
    echo "cat21-ord never indexed the seed cat (count stuck at $COUNT)" >&2
    curl -s -H 'Accept: application/json' "$ORD_URL/blockcount" >&2 || true
    exit 1
  fi
  sleep 2
done

for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$ELECTRS_URL/tx/$TXID" 2>/dev/null || true)
  if [ "$code" = 200 ]; then echo "electrs indexed the seed mint tx"; break; fi
  if [ "$i" = 60 ]; then echo "electrs never indexed the seed mint tx (last HTTP $code)" >&2; exit 1; fi
  sleep 2
done

# The specs read the stack's ports from the slot environment (stackUrl).
cd "$BACKEND"
SEED_MINT_TXID="$TXID" npm run test:regtest
