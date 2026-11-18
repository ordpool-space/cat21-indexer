import { execFileSync } from 'node:child_process';

import type { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { stackPort, stackUrl } from 'ordpool-sdk/e2e/stack';

import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { bids } from '../shared/drizzle/schema/bids';
import { ElectrsClientService } from '../sync/electrs-client.service';
import { OrdClientService } from '../sync/ord-client.service';
import { BidsPruner } from './bids.pruner';
import { BidsService } from './bids.service';

/**
 * REAL integration test — NO MOCK. Runs the BIDS pruner against a live regtest
 * cat21-ord + electrs + a live MariaDB (the consumer-environment stack this lane
 * boots), never the pure-unit `npm test`.
 *
 * ## LOAD-BEARING: the bids pruner's only real-ord seam test. Do not delete it.
 *
 * `bids.pruner.spec.ts` mocks `OrdClientService.getCatsAtOutput`, so it proves
 * the drop LOGIC but never that the SDK's `getCatsAtOutput` returns `null` for
 * cat21-ord's real 200 `{spent:true, indexed:false, sat_ranges:null}` answer on
 * a spent output. That is exactly the B9 bug: the old SDK THREW there, so the
 * pruner hit `ordErrors++; continue;` and NEVER closed a bid after a sale; a
 * method-level mock returning `null` agreed with the fix but could not prove the
 * real translation. This spec is where the two meet on real infra.
 *
 * ## What it proves (B9)
 *
 * A cat sold by a FOREIGN settle (not our SDK/wallet, so NOT `nLockTime=21`)
 * leaves the bid's outpoint spent. cat21-ord answers `spent:true` there, the
 * SDK's `getCatsAtOutput` maps that to `null`, the pruner reads it as
 * seller-side stale, and the bid is dropped — no more dead bids in the public
 * feed after a sale.
 *
 * The foreign settle is a plain bitcoind raw transfer with `locktime=0`
 * (`createrawtransaction` writes the locktime verbatim). For the pruner's
 * seller-side check that is equivalent to a marketplace accept: it reads only
 * whether the cat still sits on the signed outpoint. This lane runs no
 * ord-stock, so the raw transfer stands in and asserts nothing about locktime.
 *
 * Mutation check: break the pruner's seller-side-stale condition in
 * `bids.pruner.ts` (`live === null || live.length === 0` → `false`); the bid is
 * no longer closed and the final `toHaveLength(0)` turns red.
 */

const CAT_SATS = 2_500; // a non-546 size, so size handling is exercised too
const MINT_FEE_SATS = 5_000;
const MOVE_FEE_SATS = 5_000;
const WALLET = process.env.REGTEST_WALLET || 'ordpool-e2e';
const BITCOIND = process.env.REGTEST_BITCOIND_CONTAINER;

/** `bitcoin-cli` inside the stack's bitcoind container, as the lane's bash does. */
function bcli(...args: string[]): string {
  if (!BITCOIND) throw new Error('REGTEST_BITCOIND_CONTAINER is not set; run inside the regtest lane');
  return execFileSync(
    'docker',
    ['exec', BITCOIND, 'bitcoin-cli', '-regtest', '-rpcuser=ordpool', '-rpcpassword=ordpool', ...args],
    { encoding: 'utf8' },
  ).trim();
}
function bcliJson<T>(...args: string[]): T {
  return JSON.parse(bcli(...args)) as T;
}
const wcli = (...args: string[]): string => bcli(`-rpcwallet=${WALLET}`, ...args);
const wcliJson = <T>(...args: string[]): T => bcliJson<T>(`-rpcwallet=${WALLET}`, ...args);

/** Exact sats → BTC decimal string, no float round-trip (546 → "0.00000546"). */
function satsToBtc(sats: number): string {
  const s = String(sats).padStart(9, '0');
  return `${s.slice(0, -8)}.${s.slice(-8)}`;
}

interface Unspent { txid: string; vout: number; amount: number }

/** A confirmed wallet UTXO worth at least `minSats`, excluding `exclude` outpoints. */
function pickFundingUtxo(minSats: number, exclude: Set<string> = new Set()): Unspent {
  const unspent = wcliJson<Unspent[]>('listunspent', '1');
  const pick = unspent.find(
    (u) => Math.round(u.amount * 1e8) >= minSats && !exclude.has(`${u.txid}:${u.vout}`),
  );
  if (!pick) throw new Error(`no confirmed UTXO >= ${minSats} sats in wallet ${WALLET}`);
  return pick;
}

function mine(blocks = 1): void {
  const addr = wcli('getnewaddress');
  bcli('generatetoaddress', String(blocks), addr);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function poll<T>(fn: () => Promise<T | null>, label: string, tries = 90, delayMs = 2_000): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v !== null && v !== undefined) return v;
    await sleep(delayMs);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const ORD_API_URL = process.env.ORD_API_URL ?? stackUrl('ord');
const ELECTRS_API_URL = process.env.ELECTRS_API_URL ?? stackUrl('electrs');
const DATABASE_URL = process.env.DATABASE_URL ?? `mysql://cat21:cat21@127.0.0.1:${stackPort('mariadb')}/cat21`;

function configStub(value: string): ConfigService {
  return { getOrThrow: () => value } as unknown as ConfigService;
}

describe('BidsPruner against a REAL regtest cat21-ord + electrs + MariaDB (no mock)', () => {
  let drizzle: DrizzleService;
  let ordClient: OrdClientService;
  let pruner: BidsPruner;

  // The seeded cat and its FIRST (bid) outpoint.
  let catNumber: number;
  let mintTxid: string;
  const bidNetwork = 'regtest';
  const BUYER = 'bcrt1pbuyer00000000000000000000000000000000000000000000000000000';

  beforeAll(async () => {
    process.env.BACKEND_NETWORK = bidNetwork;

    drizzle = new DrizzleService(configStub(DATABASE_URL));
    await drizzle.onModuleInit(); // applies migrations, incl. the bids table
    ordClient = new OrdClientService(configStub(ORD_API_URL));
    const electrsClient = new ElectrsClientService(configStub(ELECTRS_API_URL));
    const bidsService = new BidsService(drizzle, ordClient, electrsClient);
    pruner = new BidsPruner(drizzle, ordClient, electrsClient, bidsService);

    // --- Seed a bitcoind-owned cat (so bitcoind can later spend it) ---
    // A locktime=21 mint, built with createrawtransaction so the locktime is
    // written verbatim (cat21-ord indexes a tx as a cat iff lockTime == 21).
    const funding = pickFundingUtxo(1_000_000);
    const catAddr = wcli('getnewaddress', '', 'bech32'); // the cat's owner O
    const changeAddr = wcli('getnewaddress');
    const changeSats = Math.round(funding.amount * 1e8) - CAT_SATS - MINT_FEE_SATS;
    const mintInputs = JSON.stringify([{ txid: funding.txid, vout: funding.vout }]);
    const mintOutputs =
      `[{"${catAddr}":${satsToBtc(CAT_SATS)}},{"${changeAddr}":${satsToBtc(changeSats)}}]`;
    const mintRaw = bcli('createrawtransaction', mintInputs, mintOutputs, '21');
    const mintSigned = bcliJson<{ hex: string }>(`-rpcwallet=${WALLET}`, 'signrawtransactionwithwallet', mintRaw).hex;
    mintTxid = bcli('sendrawtransaction', mintSigned);
    expect(bcliJson<{ locktime: number }>('getrawtransaction', mintTxid, 'true').locktime).toBe(21);
    mine(1);

    const cat = await poll(() => ordClient.getCat(`${mintTxid}i0`), `cat21-ord to index mint ${mintTxid}`);
    catNumber = cat.number;

    // --- Post a bid on the ORIGINAL cat outpoint ---
    // The PSBT is a placeholder: after the settle the pruner finds the cat
    // seller-side stale (getCatsAtOutput -> null on the spent output) and drops
    // the row BEFORE the buyer-side PSBT parse, so its bytes never matter here.
    await drizzle.db.insert(bids).values({
      network: bidNetwork,
      catTxid: mintTxid,
      catVout: 0,
      catsOnUtxo: [catNumber],
      headlineCatNumber: catNumber,
      bidSats: 50_000,
      buyerOrdinalsAddress: BUYER,
      buyerPaymentAddress: changeAddr,
      sellerPaymentAddress: catAddr,
      psbtBase64: 'cHNidP8BAAoAAAAAAAAAAAAAAA==', // minimal empty PSBT; unused on a seller-side drop
    });
  }, 300_000);

  afterAll(async () => {
    if (drizzle?.db && mintTxid) {
      await drizzle.db
        .delete(bids)
        .where(and(eq(bids.catTxid, mintTxid), eq(bids.catVout, 0)));
    }
    await drizzle?.onModuleDestroy();
  });

  it('closes a bid after a foreign (locktime != 21) settle spends the cat outpoint', async () => {
    // Precondition: the bid is live on the original outpoint.
    const before = await drizzle.db
      .select()
      .from(bids)
      .where(and(eq(bids.catTxid, mintTxid), eq(bids.catVout, 0)));
    expect(before).toHaveLength(1);

    // --- Foreign settle: a bitcoind raw transfer with locktime = 0 ---
    // Input 0 is the cat UTXO (its first sat carries the cat); output 0 goes to
    // the buyer and preserves the cat value, so FIFO lands the cat at the buyer.
    // Input 1 funds the fee. locktime 0, NOT 21 — a foreign-built move.
    const buyerAddr = wcli('getnewaddress', '', 'bech32');
    const moveChangeAddr = wcli('getnewaddress');
    const moveFunding = pickFundingUtxo(1_000_000, new Set([`${mintTxid}:0`]));
    const moveChangeSats = Math.round(moveFunding.amount * 1e8) - MOVE_FEE_SATS;
    const moveInputs = JSON.stringify([
      { txid: mintTxid, vout: 0 },
      { txid: moveFunding.txid, vout: moveFunding.vout },
    ]);
    const moveOutputs =
      `[{"${buyerAddr}":${satsToBtc(CAT_SATS)}},{"${moveChangeAddr}":${satsToBtc(moveChangeSats)}}]`;
    const moveRaw = bcli('createrawtransaction', moveInputs, moveOutputs, '0');
    const moveSigned = bcliJson<{ hex: string; complete: boolean }>(
      `-rpcwallet=${WALLET}`, 'signrawtransactionwithwallet', moveRaw,
    );
    expect(moveSigned.complete).toBe(true);
    const moveTxid = bcli('sendrawtransaction', moveSigned.hex);
    // The settle is a foreign tx: it carries locktime 0, not 21.
    expect(bcliJson<{ locktime: number }>('getrawtransaction', moveTxid, 'true').locktime).toBe(0);
    mine(1);

    // --- Effect 1: the cat is at the buyer (indexer processed it as valid) ---
    const moved = await poll(
      async () => {
        const loc = await ordClient.getCatCurrentLocation(catNumber);
        return loc && loc.txid === moveTxid ? loc : null;
      },
      `cat21-ord to track cat #${catNumber} to the settle outpoint`,
    );
    expect(moved.txid).toBe(moveTxid);
    expect(moved.vout).toBe(0);
    expect(moved.ordinalsAddress).toBe(buyerAddr);

    // --- Effect 2: the bids pruner closes the stale bid ---
    // getCatsAtOutput on the spent outpoint now returns null (cat21-ord answers
    // spent:true, the SDK maps it), so the pruner reads seller-side stale and
    // drops the bid.
    await pruner.runPrune();

    const after = await drizzle.db
      .select()
      .from(bids)
      .where(and(eq(bids.catTxid, mintTxid), eq(bids.catVout, 0)));
    expect(after).toHaveLength(0);
  }, 300_000);
});
