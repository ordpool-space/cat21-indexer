import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import {
  AUTO_SCAN_MAX_VALUE_SAT,
  CandidateFeeRow,
  Cat21MintOrchestrator,
  Cat21Service,
  MintSnapshot,
  SMALL_UTXO_WARNING_THRESHOLD_SAT,
  SimulateTransactionResult,
  TxnOutput,
  UtxoAssetDetail,
  UtxoContent,
  UtxoContentScanner,
  UtxoScanBucket,
  UtxoScanState,
  UtxoSimulationRow,
  WalletService,
  ExpertRequiredCause,
  bucketOf,
  calculateRecommendedFundingSats,
  expertRequiredCause,
  outpointKey,
  runeNamesFromContent,
  usesSingleAddress,
} from 'ordpool-sdk';

import { bitcoinNetwork, cat21Config } from '../../shared/sdk-tokens';

import { cat21OrchestratorPorts } from '../../shared/cat21-orchestrator-ports';
import { DroppedSelectionNotice } from '../../shared/dropped-selection-notice/dropped-selection-notice';
import { FundingAssetList } from '../../shared/funding-asset-list/funding-asset-list';
import { FeesPicker } from '../../shared/fees-picker/fees-picker';
import { UtxoPicker } from '../../shared/utxo-picker/utxo-picker';
import { PsbtExportBridgeService } from '../../shared/psbt-export-bridge/psbt-export-bridge.service';
import { rareSatLabel } from '../../shared/rare-sat-label';
import { inscriptionReviewLink, runeEtchingReviewLink } from '../../shared/funding-asset-links';
import { runeRowLabel } from '../../shared/rune-row-label';
import { RuneEtchingService } from '../../shared/rune-etching.service';
import { SingleAddressNote } from '../../shared/single-address-note/single-address-note';
import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';

interface ViableUtxoRow {
  utxo: TxnOutput;
  simulation: SimulateTransactionResult;
  scan: UtxoScanState;
  bucket: UtxoScanBucket;
}

@Component({
  selector: 'app-mint',
  templateUrl: './mint.html',
  styleUrl: './mint.scss',
  imports: [DecimalPipe, RouterLink, FeesPicker, WalletConnect, SingleAddressNote, UtxoPicker, FundingAssetList, DroppedSelectionNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Mint {
  private psbtBridge = inject(PsbtExportBridgeService);
  private scanner = inject(UtxoContentScanner);
  private runeEtching = inject(RuneEtchingService);
  private walletService = inject(WalletService);
  private config = inject(cat21Config);
  private destroyRef = inject(DestroyRef);

  /**
   * The framework-agnostic mint orchestrator, CONSTRUCTED (not injected — the
   * SDK's Angular @Injectable orchestrators are gone). It owns the
   * select -> fee -> build -> sign -> broadcast pipeline with signing wired
   * internally; we only wire the four shared ports + read its snapshot.
   *
   * The `inject(..., { optional: true }) ??` prefix is the unit-test seam: in
   * production nothing provides the SDK class, so it resolves to `null` and the
   * real orchestrator is `new`-constructed here. A spec provides a drivable
   * stub via `{ provide: Cat21MintOrchestrator, useValue }`, which short-
   * circuits the `new` (and its `inject`ed deps) entirely.
   */
  private orch = inject(Cat21MintOrchestrator, { optional: true })
    ?? new Cat21MintOrchestrator(
      // `'derive'` opts mint into the asset-to-miner safeguard: when only a
      // coin with NAMED assets covers, a separate-address wallet NOTICEs and
      // proceeds and a one-address wallet WARNs and blocks; a coin whose assets
      // are unnamed or whose content is unknown blocks on every wallet. The
      // orchestrator resolves the topology from the wallet context it holds
      // (setWallet), so this page never computes it.
      cat21OrchestratorPorts(inject(Cat21Service), this.config, inject(bitcoinNetwork), 'derive'),
    );

  /** Reactive mirror of the orchestrator's snapshot; bound once in the constructor. */
  private snap = signal<MintSnapshot>(this.orch.getSnapshot());

  /** Where successfully minted tx ids link out (ordpool owns the tx-detail page). */
  readonly txLinkBase = 'https://ordpool.space/tx/';

  /** In-family review link for an inscription found on a funding UTXO (shared). */
  readonly inscriptionReviewLink = inscriptionReviewLink;

  /** Shared rune-row balance formatter (formatRunePile + name); same on the picker. */
  readonly runeRowLabel = runeRowLabel;

  /** Shared rare-sat identity line (see rare-sat-label.ts); same on the picker. */
  readonly rareSatLabel = rareSatLabel;

  /** [name, balance-value] pairs on a scanned UTXO, for the rune rows. */
  runeEntries(content: UtxoContent): [string, unknown][] {
    return Object.entries(content.runes ?? {});
  }

  /**
   * In-family etching-tx link for a rune, once its name has resolved, else null
   * (render plain text). Resolution is kicked off per scan by the effect below,
   * never per render.
   */
  runeEtchingHref(name: string): string | null {
    const txid = this.runeEtching.etchings().get(name);
    return txid ? runeEtchingReviewLink(txid, name) : null;
  }

  /**
   * Sat-page link for the cats on a funding UTXO, shown in the "you are about
   * to spend this" warning. All cats at an outpoint share offset 0, so one sat
   * page lists every one of them and shows where each sits now. The mint tx
   * would be wrong here: it shows where a cat started, not where it is after a
   * transfer.
   */
  catSatLink(catSat: number): string {
    return `https://cat21.space/sat/${catSat}`;
  }

  /** Auto-scan threshold passed through to the template for the "Scan anyway" label. */
  readonly autoScanThreshold = AUTO_SCAN_MAX_VALUE_SAT;

  // ---------- Live state ----------

  /**
   * Connected wallet from WalletService. The orchestrator no longer owns the
   * wallet; we push it in via `setWallet` (see the constructor effect).
   */
  /* jscpd:ignore-start -- deliberate parallel signal glue across the four money-path
     pages (mint, transfer, make-offer, accept-offer): each binds the connected wallet
     via toSignal and mirrors the orchestrator snapshot into per-page computeds. The
     "setWallet re-emission" rule keeps this per-page and guarded (no shared base), so
     it is marked here, not extracted. */
  readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });
  readonly state = computed(() => this.snap().state);
  readonly errorMessage = computed(() => this.snap().errorMessage);
  readonly successTxId = computed(() => this.snap().successTxId);
  readonly feeRate = computed(() => this.snap().feeRate);
  /* jscpd:ignore-end */
  /** The person's explicit pick (`selectUtxoOutput`), null while the SDK chooses. */
  readonly selectedUtxo = computed(() => this.snap().selectedUtxo);

  /**
   * The coin the mint spends: the person's pick while it still covers, the
   * SDK's recommendation on `auto` and `asset-notice` otherwise, null when the
   * SDK spends nothing. Read from the snapshot, never matched up locally, so the
   * coin shown is the coin `mint()` spends.
   */
  readonly resolvedFundingUtxo = computed(() => this.snap().resolvedFundingUtxo);

  /**
   * The verdict that goes with `resolvedFundingUtxo`: `scanning` while a
   * recompute is in flight, `null` after a failed one. The CTA proceeds only on
   * `ready` and `asset-notice`.
   */
  readonly resolvedFundingStatus = computed(() => this.snap().resolvedFundingStatus);

  /** Set when the coin the person picked is not the coin the mint spends, with the reason. */
  readonly droppedSelection = computed(() => this.snap().droppedSelection);

  private readonly simulations = computed<UtxoSimulationRow[]>(() => this.snap().simulations);
  private readonly scanStates = toSignal(this.scanner.states$, { initialValue: new Map<string, UtxoScanState>() as ReadonlyMap<string, UtxoScanState> });

  /**
   * The SDK's safe-auto funding recommendation: a content-clean covering coin
   * (`status: 'auto'`), or a non-auto status when only asset-bearing /
   * unknown-content / still-scanning / insufficient coins cover. It is the
   * single source of the mint's auto-pick, never a raw value-based pre-pick
   * (which would adopt an unscanned or scan-failed coin). One implementation in
   * the SDK so ordpool + cat21.space + the wallet can't drift.
   */
  private readonly fundingRecommendation = computed(() => this.snap().fundingRecommendation);

  /** True when no content-clean coin covers the mint and the SDK blocks, so
   *  the picker must surface for a deliberate override. */
  readonly fundingExpertRequired = computed(() => this.fundingRecommendation()?.status === 'expert-required');

  /**
   * Why the SDK blocks, read off its recommendation (`expertRequiredCause`),
   * null unless the status is `expert-required`. The warning copy branches on
   * it: `named-assets` names what the covering coin carries (a one-address
   * wallet), `unnamed-assets` says the scan found assets it could not name,
   * `unknown-content` says the covering coins could not be checked.
   */
  readonly expertCause = computed<ExpertRequiredCause | null>(() => {
    const rec = this.fundingRecommendation();
    return rec?.status === 'expert-required' ? expertRequiredCause(rec) : null;
  });

  /** The assets the `named-assets` warning names, from the recommended coin. */
  readonly expertAssets = computed<UtxoAssetDetail | null>(() =>
    this.expertCause() === 'named-assets' ? (this.fundingRecommendation()?.recommended?.assets ?? null) : null,
  );

  /**
   * `asset-notice`: no clean coin covers, but a coin whose assets the scan
   * NAMED does AND the wallet keeps a SEPARATE payment address, so the SDK
   * auto-selects that coin and we INFORM rather than block (the maintainer's
   * asset-to-miner ruling). The CTA stays enabled: the proceed-vs-block decision
   * is the SDK's (`resolveFundingPick` returns the coin here, null on
   * `expert-required`), not this template's. The notice obligation is ours:
   * name what sits on the coin, visibly, before the click.
   */
  readonly assetNotice = computed(() => this.fundingRecommendation()?.status === 'asset-notice');

  /**
   * Diagnostic-only (rendered into a display:none marker like transfer's), so an
   * e2e can attribute a stuck funding state precisely instead of guessing from a
   * screenshot: the recommendation status, whether a coin was auto-selected, and
   * the two address-topology inputs `resolveFundingTopology('derive', …)` reads.
   */
  readonly debugFunding = computed(() => {
    const rec = this.fundingRecommendation();
    const w = this.connectedWallet();
    const r = rec?.recommended;
    return {
      status: rec?.status ?? 'none',
      hasSelected: !!this.resolvedFundingUtxo(),
      hasRecommended: !!r,
      recommendedOutpoint: r ? `${r.txid}:${r.vout}` : '',
      candidates: rec?.candidates?.length ?? 0,
      payEqOrd: !!w && w.paymentAddress === w.ordinalsAddress,
    };
  });

  /**
   * The asset detail the notice must name, taken from the RECOMMENDATION itself
   * (the coin the SDK picked), never from a second scan of the coin. Null unless
   * the status is `asset-notice`, where the SDK guarantees it names at least one
   * asset (`namesAssets`).
   */
  readonly noticeAssets = computed<UtxoAssetDetail | null>(() => {
    const rec = this.fundingRecommendation();
    return rec?.status === 'asset-notice' ? (rec.recommended?.assets ?? null) : null;
  });

  /**
   * Every viable (sufficient) UTXO annotated with scan state + bucket, sorted
   * desc by value. Uncapped: the SDK's best-fit recommendation is the SMALLEST
   * covering coin, which can fall outside the top-10-by-value display list, so
   * the summary row of the coin the mint spends is looked up in this full set,
   * not the capped display list.
   */
  readonly allViableRows = computed<ViableUtxoRow[]>(() => {
    const rows = this.simulations();
    const scanMap = this.scanStates();
    return rows
      .filter((r): r is { utxo: TxnOutput; simulation: SimulateTransactionResult; insufficient: false } =>
        !r.insufficient && r.simulation !== null,
      )
      .sort((a, b) => b.utxo.value - a.utxo.value)
      .map((r): ViableUtxoRow => {
        const outpoint = `${r.utxo.txid}:${r.utxo.vout}`;
        const scan = scanMap.get(outpoint) ?? { kind: 'not-scanned' };
        return { utxo: r.utxo, simulation: r.simulation, scan, bucket: bucketOf(scan) };
      });
  });

  /** The "choose a different source" display list: the viable rows capped at 10
   *  (highest-value first) to keep the expert picker readable. */
  readonly viableRows = computed<ViableUtxoRow[]>(() => this.allViableRows().slice(0, 10));

  /**
   * The candidate coins the shared `UtxoPicker` enumerates: the SDK's full
   * annotated candidate list (same source transfer + make-offer feed it), so
   * unfundable coins show in place marked "can't fund" rather than vanishing.
   */
  readonly pickerUtxos = computed<readonly TxnOutput[]>(
    () => this.fundingRecommendation()?.candidates ?? [],
  );

  /**
   * Per-coin fee for the picker's fee column, keyed by `outpointKey`, straight
   * from the orchestrator snapshot's `candidateFees` (the SDK owns the three
   * fee states via `absorbedSubDustSats`; a new SDK test pins this number to the
   * orchestrator's own per-UTXO grid, so it agrees with the summary panel).
   */
  readonly feeByOutpoint = computed<ReadonlyMap<string, CandidateFeeRow>>(
    () => new Map(this.snap().candidateFees.map((f) => [outpointKey(f), f])),
  );

  /** Scan floor: coins below the funding requirement can't fund the mint, so
   *  the picker skips scanning them. */
  readonly fundingRequirementSats = computed(() => this.snap().fundingRequirementSats);

  /**
   * `outpointKey` of the coin the picker marks ★ recommended, in place (never a
   * re-sort). Only on `auto` and `asset-notice`, the two statuses where the SDK
   * itself would spend that coin. On `expert-required` the SDK still names a
   * best-fit coin, but it is the one it refuses to spend: a star on it would
   * recommend exactly what the warning above it advises against.
   */
  readonly recommendedOutpoint = computed<string | null>(() => {
    const rec = this.fundingRecommendation();
    if (rec?.status !== 'auto' && rec?.status !== 'asset-notice') return null;
    return rec.recommended ? outpointKey(rec.recommended) : null;
  });

  /**
   * The mint proceeds when a fee rate is set, the orchestrator is idle, and the
   * SDK's verdict on the coin it would spend is `ready` or `asset-notice`.
   */
  readonly canMint = computed(() => {
    if (this.feeRate() === null || this.state() !== 'ready') return false;
    const status = this.resolvedFundingStatus();
    return !!this.resolvedFundingUtxo() && (status === 'ready' || status === 'asset-notice');
  });

  /** The viable rows keyed by `outpointKey`, for the summary lookup. */
  private readonly viableRowByOutpoint = computed<ReadonlyMap<string, ViableUtxoRow>>(
    () => new Map(this.allViableRows().map((r) => [outpointKey(r.utxo), r])),
  );

  /** The summary panel's row: the coin the mint spends, with its simulation and scan state. */
  readonly selectedRow = computed<ViableUtxoRow | null>(() => {
    const spend = this.resolvedFundingUtxo();
    return spend ? (this.viableRowByOutpoint().get(outpointKey(spend)) ?? null) : null;
  });

  /**
   * Whether the "Choose a different funding source" panel opens
   * pre-expanded. True when the person's pick was replaced
   * (`droppedSelection`, the notice asks them to pick another) and in the
   * shallow-water cases (the SDK spends no coin, or the coin it spends is one
   * whose safety we couldn't verify), false on the happy path (a clean or
   * probably-clean source). Users can still toggle either way.
   */
  readonly pickerOpenByDefault = computed<boolean>(() => {
    if (this.droppedSelection()) return true;
    const sel = this.selectedRow();
    if (!sel) return this.viableRows().length > 0;
    return sel.bucket === 'assets' || sel.bucket === 'failed';
  });

  readonly recommendedFundingSats = computed<number>(() => calculateRecommendedFundingSats(this.feeRate() ?? 1));

  /**
   * Whether the connected wallet exposes one address for both payments
   * and ordinals. Uses the SDK's `usesSingleAddress` (ground truth: it
   * compares the two addresses the wallet actually returned). Unisat / OKX
   * / Wizz / Binance / Alby: same. Xverse / Leather / Phantom / Cat21
   * Wallet: different. On a single-address wallet, every UTXO at the
   * payment address is also potentially an ordinals-bearing UTXO; the
   * picker has to warn the user before they accidentally spend an
   * inscription / rune / cat sat as transaction change.
   */
  readonly isSingleAddressWallet = computed<boolean>(() => usesSingleAddress(this.connectedWallet()));

  /**
   * Whether to show the "small UTXO on single-address wallet" warning
   * for the currently selected row. Stays fee-rate-agnostic; purely
   * a content-safety hint about small UTXOs that we couldn't (or
   * weren't asked to) scan. Once a row is `scanned-clean`, this
   * disappears; once a row is `scanned-with-assets`, the more
   * specific asset-found warning takes over.
   */
  readonly showSmallUtxoWarning = computed<boolean>(() => {
    const sel = this.selectedRow();
    if (!sel) return false;
    if (!this.isSingleAddressWallet()) return false;
    if (sel.bucket === 'clean' || sel.bucket === 'assets') return false;
    return sel.utxo.value <= SMALL_UTXO_WARNING_THRESHOLD_SAT;
  });

  /** Was a UTXO-load error from the orchestrator. */
  readonly utxoError = computed(() => this.state() === 'error' && !this.mintAttempted() ? this.errorMessage() : null);

  /** Was a mint-time error from the orchestrator. */
  readonly mintError = computed(() => this.state() === 'error' && this.mintAttempted() ? this.errorMessage() : null);

  private mintAttempted = signal(false);
  private lastWalletAddress: string | null = null;

  // ---------- Lifecycle ----------

  constructor() {
    // Bind the orchestrator snapshot to a signal (fires immediately + on every
    // change). Unsubscribe on destroy.
    this.destroyRef.onDestroy(this.orch.subscribe((s) => this.snap.set(s)));

    // Kick off rune-etching lookups when a flagged source is selected, not per
    // render. Only the selected source shows a rune row here (the expert list
    // shows value + fee), so resolving its names covers the panel; the service
    // is idempotent and caches, so re-selecting the same coin costs nothing.
    effect(() => {
      const sel = this.selectedRow();
      if (sel?.scan.kind === 'scanned-with-assets') {
        this.runeEtching.resolve(this.runeNames(sel.scan.content));
      }
    });

    // Push wallet changes into the orchestrator; it (re)fetches the wallet's
    // UTXOs and recomputes. `setWallet` is async + dedupes internally, so a
    // BehaviorSubject re-emission of the same wallet is a no-op there.
    /* jscpd:ignore-start -- the setWallet push effect is deliberately mirrored on each
       money-path page; the "setWallet re-emission" rule keeps it per-page and guarded
       in the SDK, so it is marked, not extracted into a shared base. */
    effect(() => {
      const w = this.connectedWallet();
      void this.orch.setWallet(
        w
          ? {
              type: w.type,
              ordinalsAddress: w.ordinalsAddress,
              paymentAddress: w.paymentAddress,
              paymentPublicKey: w.paymentPublicKey,
            }
          : null,
      );
    });
    /* jscpd:ignore-end */

    // Wipe the scanner cache when one wallet swaps out for another —
    // the previous wallet's UTXO outpoints aren't relevant to the new
    // one and would otherwise accumulate forever on a long-lived
    // session. Initial null → wallet is excluded: the scanner is
    // already empty so a reset would be a no-op anyway, and skipping
    // it avoids clobbering scan state any consumer pushed in early.
    effect(() => {
      const addr = this.connectedWallet()?.ordinalsAddress ?? null;
      if (this.lastWalletAddress !== null && addr !== this.lastWalletAddress) {
        this.scanner.reset();
      }
      this.lastWalletAddress = addr;
    });

    // Eager-scan small UTXOs the moment they arrive from electrs. The
    // scanner dedupes by outpoint + throttles fan-out internally, so
    // repeat triggers are free.
    effect(() => {
      const rows = this.viableRows();
      this.scanner.autoScan(rows.map((r) => ({ txid: r.utxo.txid, vout: r.utxo.vout, value: r.utxo.value })));
    });
  }

  // ---------- Commands ----------

  selectUtxo(row: ViableUtxoRow): void {
    this.selectUtxoOutput(row.utxo);
  }

  /**
   * The shared `UtxoPicker`'s `selectionChange` handler: the person's explicit
   * pick. The SDK keeps spending it while it covers and reports a replaced pick
   * in `droppedSelection` (the picker disables the pick control on unfundable
   * rows, so this only ever receives a coin that can fund at the current rate).
   */
  selectUtxoOutput(utxo: TxnOutput): void {
    this.orch.setSelectedUtxo(utxo);
  }

  scanRow(row: ViableUtxoRow): void {
    this.scanner.scan(`${row.utxo.txid}:${row.utxo.vout}`).subscribe();
  }

  /**
   * "Retry scan" on the `unknown-content` warning. The recommendation comes from
   * the orchestrator's own scan port, so the retry re-reads the wallet's coins
   * through the orchestrator (a failed scan is never cached, so the covering
   * coins are scanned again), and re-scans the recommended coin's row badge.
   */
  retryFundingScan(): void {
    const r = this.fundingRecommendation()?.recommended;
    if (r) {
      this.scanner.scan(outpointKey(r)).subscribe();
    }
    void this.orch.refreshUtxos();
  }

  async mint(): Promise<void> {
    this.mintAttempted.set(true);
    try {
      // Pass the export/paste bridge unconditionally: injected wallets ignore
      // it, a watch-only (xpub) wallet signs through it. The bridge is
      // Observable-based; the orchestrator wants a Promise, so bridge it. The
      // orchestrator signs+broadcasts internally and updates its snapshot
      // (state/errorMessage/successTxId), so there is nothing to bind here.
      await this.orch.mint((unsigned) => firstValueFrom(this.psbtBridge.promptForSignedPsbt(unsigned)));
    } catch {
      // A sign or broadcast failure lands in the snapshot (state 'error',
      // errorMessage), which mintError() surfaces. A FundingBlockedError is
      // thrown before the snapshot changes, and only while its
      // fundingRecommendation is `expert-required`: the expert-required warning
      // already renders that recommendation's cause and named assets, the same
      // facts the error carries, and the CTA is disabled.
    }
  }

  mintAnother(): void {
    this.mintAttempted.set(false);
    this.orch.reset();
  }

  // ---------- Template helpers ----------

  /** Helper for template — bigint → number for the | number pipe. */
  toNumber(n: bigint): number { return Number(n); }

  /** Pass-through to the SDK helper so the template can read rune names off a UtxoContent. */
  runeNames(content: UtxoContent): string[] { return runeNamesFromContent(content); }

  /** FeesPicker's feeRateChange forwarded into this page's orchestrator. */
  onFeeRateChange(rate: number): void {
    this.orch.setFeeRate(rate);
  }
}
