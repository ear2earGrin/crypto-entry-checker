#!/usr/bin/env node
/**
 * Headless backtest harness — "the wind tunnel."
 *
 * Imports the SAME pure modules the live React UI uses (src/indicators, src/strategy,
 * src/backtest), so there is exactly one implementation of every rule and zero drift
 * between what you backtest and what the Scanner shows you live.
 *
 * Runs, across the whole universe, in one command:
 *   - single-asset backtest + metrics per asset
 *   - multi-asset portfolio backtest (respects all portfolio rules)
 *   - sub-period stability per asset (consecutive 6-month windows; NOT out-of-sample)
 *   - benchmarks scored identically (Sharpe, maxDD): BTC / equal-weight buy-and-hold
 *     and "regime-hold" (the 50W-SMA filter without the Donchian timing)
 *   - drawdown planning: stationary block bootstrap of daily mark-to-market returns
 *   - timing-skill test: drift-preserving joint bar permutation (plus the weaker
 *     sign-flip test, labelled for what it is)
 * and writes a timestamped Markdown + JSON report into reports/.
 *
 * Usage:
 *   node scripts/backtest.mjs                         # full run, universe, from 2020
 *   node scripts/backtest.mjs --from 2021 --asset BTC # single asset
 *   node scripts/backtest.mjs --risk 0.5 --fee 0.1
 *   node scripts/backtest.mjs --to 2026-07-18         # exclusive end date (reproducible)
 *   node scripts/backtest.mjs --perm-runs 999         # bar-permutation runs (default 199)
 *   node scripts/backtest.mjs --selftest             # synthetic data, no network
 *                                                     # (bar permutation skipped unless --perm-runs)
 *
 * Network note: this hits api.binance.com directly (Node has no CORS, so no proxy
 * needed). If you are behind a restricted network it will fail with a clear message;
 * run it from a machine that can reach Binance.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { backtestOne } from "../src/backtest/engine.js";
import { backtestPortfolio } from "../src/backtest/portfolio.js";
import { walkForward } from "../src/backtest/walkforward.js";
import { computeMetrics, dailyReturns, equityCurveStats } from "../src/backtest/metrics.js";
import {
  bootstrapTradeSequence, permutationEdgeTest, barPermutationTest,
  blockBootstrapMaxDrawdown, probMaxDDAtLeast,
} from "../src/backtest/montecarlo.js";
import { buyAndHold, regimeHold } from "../src/backtest/benchmarks.js";
import { PRESET_V1, PRESET_V2 } from "../src/strategy/presets.js";
import { UNIVERSE, loadAsset, loadFunding, synth, synthFunding, beforeEnd, hashData, f, pct } from "./lib/data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, "..", "reports");

// ---------- args ----------
function parseArgs(argv) {
  const a = { from: 2020, to: null, risk: 1, fee: 0.08, slip: 0.05, equity: 100000, asset: null, selftest: false, longOnly: false, preset: "v2", permRuns: null, permBlock: 1 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--selftest") a.selftest = true;
    else if (k === "--long-only") a.longOnly = true;
    else if (k === "--preset") a.preset = String(argv[++i]);
    else if (k === "--from") a.from = Number(argv[++i]);
    else if (k === "--to") a.to = String(argv[++i]);
    else if (k === "--perm-runs") a.permRuns = Number(argv[++i]);
    else if (k === "--perm-block") a.permBlock = Number(argv[++i]);
    else if (k === "--risk") a.risk = Number(argv[++i]);
    else if (k === "--fee") a.fee = Number(argv[++i]);
    else if (k === "--slip") a.slip = Number(argv[++i]);
    else if (k === "--equity") a.equity = Number(argv[++i]);
    else if (k === "--asset") a.asset = String(argv[++i]).toUpperCase();
  }
  return a;
}

// Closed-trade mean R — the bar-permutation statistic. Forced end-of-data
// closes are excluded (they are marks, not completed trades); no trades = 0.
function closedMeanR(trades) {
  const closed = trades.filter((t) => t.exitReason !== "end of data");
  return closed.length ? closed.reduce((s, t) => s + (t.rMultiple || 0), 0) / closed.length : 0;
}

function statsRow(name, s) {
  return `| ${name} | ${pct(s.totalReturnPct)} | ${pct(s.cagr)} | ${pct(s.maxDDPct)} | ${s.annVolPct === null ? "-" : pct(s.annVolPct)} | ${s.sharpe === null ? "-" : f(s.sharpe, 2)} |`;
}

function metricsRow(asset, m) {
  return `| ${asset} | ${m.numTrades} | ${pct(m.winRate * 100)} | ${f(m.expectancyR, 2)} | ${m.profitFactor === Infinity ? "∞" : f(m.profitFactor, 2)} | ${pct(m.totalReturnPct)} | ${pct(m.maxDDPct)} | ${pct(m.cagr)} |`;
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Presets come from src/strategy/presets.js — the SAME source the Scanner
  // uses, so what you backtest is exactly what you see live. Default is the
  // production preset (v2, validated 2026-07-18); --preset v1 runs the legacy spec.
  const presets = { v1: PRESET_V1, v2: PRESET_V2 };
  const preset = presets[args.preset];
  if (!preset) {
    console.error(`Unknown preset "${args.preset}". Known: ${Object.keys(presets).join(", ")}`);
    process.exit(1);
  }
  let sigParams = preset.signalParams;
  const regParams = preset.regimeParams;
  const exitFlip = preset.exitOnRegimeFlip;
  let modeNote = args.preset === "v2"
    ? " — PRESET v2 PRODUCTION (SMA-only regime, long-only, trail-only exit, no vetoes)"
    : " — PRESET v1 (legacy spec: full regime, both directions, vetoes)";
  if (args.longOnly) sigParams = { ...sigParams, allowShort: false };
  // --asset accepts a comma list: --asset BTC,SOL,HYPE. Any symbol is tried as
  // <SYMBOL>USDT on Binance spot; unknown listings simply FAIL that asset and the
  // run continues with the rest.
  const assets = args.asset ? args.asset.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : UNIVERSE;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  // --to YYYY-MM-DD: exclusive end date. Everything that is not complete before
  // 00:00 UTC that day is dropped, so the same --from/--to always sees the same
  // bars (the data sha256 in the report proves it).
  let toSec = null;
  if (args.to) {
    toSec = Date.parse(`${args.to}T00:00:00Z`) / 1000;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.to) || !Number.isFinite(toSec)) {
      console.error(`Bad --to "${args.to}" (expected YYYY-MM-DD)`);
      process.exit(1);
    }
  }
  const startSec = Date.UTC(args.from, 0, 1) / 1000;

  console.log(`\nBacktest harness — ${args.selftest ? "SELF-TEST (synthetic)" : "Binance data"}`);
  console.log(`Universe: ${assets.join(", ")} | from ${args.from} | to ${args.to ?? "latest"} (exclusive) | risk ${args.risk}% | fee ${args.fee}%/side | slip ${args.slip}%\n`);

  const data = {};
  const fundingByAsset = {};
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    try {
      const raw = args.selftest ? synth(asset, i * 1.7) : await loadAsset(asset, args.from, toSec ? toSec * 1000 : Date.now());
      data[asset] = { daily: beforeEnd(raw.daily, toSec), weekly: beforeEnd(raw.weekly, toSec) };
      if (!data[asset].daily.length) throw new Error("no daily bars before --to");
      console.log(`  loaded ${asset}: ${data[asset].daily.length} daily, ${data[asset].weekly.length} weekly`);
    } catch (e) {
      console.error(`  FAILED ${asset}: ${e.message}`);
      continue;
    }
    // Funding is best-effort: a perp may be younger than the spot history, or the
    // endpoint may fail — either way the price backtest still runs, with funding
    // coverage disclosed in the report.
    try {
      fundingByAsset[asset] = beforeEnd(args.selftest ? synthFunding() : await loadFunding(asset, args.from, toSec ? toSec * 1000 : Date.now()), toSec);
      console.log(`    funding ${asset}: ${fundingByAsset[asset].length} settlements`);
    } catch (e) {
      fundingByAsset[asset] = null;
      console.error(`    funding ${asset} unavailable: ${e.message}`);
    }
  }

  const loaded = Object.keys(data);
  if (!loaded.length) {
    console.error("\nNo data loaded. If not on --selftest, check network access to api.binance.com.\n");
    process.exit(1);
  }
  const dataSha = hashData(Object.fromEntries(loaded.map((a) => [a, data[a]])), fundingByAsset);
  const lastBar = Math.max(...loaded.map((a) => data[a].daily[data[a].daily.length - 1].time));
  const lastBarDate = new Date(lastBar * 1000).toISOString().slice(0, 10);
  console.log(`\n  data sha256 ${dataSha} (last daily bar ${lastBarDate})`);

  // single-asset
  const singleRows = [];
  const single = {};
  for (const asset of loaded) {
    const bt = backtestOne({ asset, ...data[asset], startEquity: args.equity, riskPct: args.risk, feePct: args.fee, slippagePct: args.slip, funding: fundingByAsset[asset], signalParams: sigParams, regimeParams: regParams, exitOnRegimeFlip: exitFlip });
    const m = computeMetrics(bt);
    single[asset] = { metrics: m, trades: bt.trades };
    singleRows.push(metricsRow(asset, m));
  }

  // portfolio
  const dailyByAsset = {}, weeklyByAsset = {};
  for (const asset of loaded) { dailyByAsset[asset] = data[asset].daily; weeklyByAsset[asset] = data[asset].weekly; }
  const port = backtestPortfolio({ dailyByAsset, weeklyByAsset, startEquity: args.equity, riskPct: args.risk, feePct: args.fee, slippagePct: args.slip, fundingByAsset, signalParams: sigParams, regimeParams: regParams, exitOnRegimeFlip: exitFlip });
  const portMetrics = computeMetrics(port);

  // Funding coverage + totals, long/short split, and buy-and-hold benchmarks —
  // the external audits asked for all three before any go/no-go reading.
  const totalFunding = port.trades.reduce((s, t) => s + (t.fundingCost || 0), 0);
  const fundingCovered = loaded.filter((a) => fundingByAsset[a]?.length).length;

  const longTrades = port.trades.filter((t) => t.direction === "LONG");
  const shortTrades = port.trades.filter((t) => t.direction === "SHORT");
  const longM = computeMetrics({ trades: longTrades, equityCurve: port.equityCurve, startEquity: args.equity });
  const shortM = computeMetrics({ trades: shortTrades, equityCurve: port.equityCurve, startEquity: args.equity });

  // Benchmarks, scored with the same equityCurveStats as the system (daily MTM
  // curve → Sharpe, vol, maxDD). Same costs: fee per side + slippage on notional.
  const benchCost = { startEquity: args.equity, feePct: args.fee, slippagePct: args.slip };
  const systemStats = equityCurveStats(port.equityCurve, args.equity);
  const benchmarks = [];
  if (loaded.includes("BTC")) {
    benchmarks.push({ name: "BTC buy-and-hold", stats: equityCurveStats(buyAndHold({ dailyByAsset, assets: ["BTC"], ...benchCost }), args.equity) });
  }
  benchmarks.push({ name: "Equal-weight buy-and-hold (universe)", stats: equityCurveStats(buyAndHold({ dailyByAsset, assets: loaded, ...benchCost }), args.equity) });
  benchmarks.push({ name: "Regime-hold (weekly close > 50W SMA, EW, weekly rebal.)", stats: equityCurveStats(regimeHold({ dailyByAsset, weeklyByAsset, assets: loaded, ...benchCost, smaPeriod: regParams.smaPeriod }), args.equity) });

  // Realized (closed) vs forced END_OF_DATA: report them separately so an open
  // winner isn't dressed up as a completed trade.
  const realizedTrades = port.trades.filter((t) => t.exitReason !== "end of data");
  const forcedClosed = port.trades.length - realizedTrades.length;
  const realizedMetrics = computeMetrics({ trades: realizedTrades, equityCurve: port.equityCurve, startEquity: args.equity });

  // Cost sensitivity: rerun the portfolio at 0 / expected / stressed slippage.
  // A system that only survives the optimistic assumption has no real edge.
  const scenarios = [
    { name: "0 bps (diagnostic)", slip: 0 },
    { name: `expected (${args.slip}%)`, slip: args.slip },
    { name: `stressed (${(args.slip * 3).toFixed(2)}%)`, slip: args.slip * 3 },
  ].map((s) => {
    const p = backtestPortfolio({ dailyByAsset, weeklyByAsset, startEquity: args.equity, riskPct: args.risk, feePct: args.fee, slippagePct: s.slip, fundingByAsset, signalParams: sigParams, regimeParams: regParams, exitOnRegimeFlip: exitFlip });
    const m = computeMetrics(p);
    return `| ${s.name} | ${m.numTrades} | ${f(m.expectancyR, 2)} | ${pct(m.totalReturnPct)} | ${pct(m.maxDDPct)} |`;
  });

  // Sub-period stability per asset. walkForward is called WITHOUT a param grid,
  // so nothing is fitted: each fold's later 6-month window just runs the frozen
  // preset. These are consecutive sub-periods of the history the preset was
  // selected on — a stability check, not out-of-sample evidence.
  const wfRows = [];
  for (const asset of loaded) {
    const wf = walkForward({ ...data[asset], asset, startEquity: args.equity, riskPct: args.risk, feePct: args.fee, slippagePct: args.slip, funding: fundingByAsset[asset], signalParams: sigParams, regimeParams: regParams, exitOnRegimeFlip: exitFlip });
    const s = wf.summary;
    const traded = wf.folds.filter((fo) => fo.oosMetrics.numTrades > 0);
    const positive = traded.filter((fo) => fo.oosMetrics.expectancyR > 0).length;
    wfRows.push(`| ${asset} | ${s.numFolds ?? 0} | ${traded.length ? `${positive}/${traded.length}` : "-"} | ${f(s.oosExpectancyR, 2)} | ${pct(s.oosMaxDDPct)} |`);
  }

  // Drawdown planning: stationary block bootstrap of the portfolio's DAILY
  // mark-to-market returns (keeps open-trade swings and volatility clustering).
  const portRets = dailyReturns(port.equityCurve);
  const bbFull = blockBootstrapMaxDrawdown(portRets, { runs: 5000, meanBlock: 30, seed: 1 });
  const bbHalf = blockBootstrapMaxDrawdown(portRets, { runs: 5000, meanBlock: 30, seed: 1, meanScale: 0.5 });
  const ddRow = (label, bb) => `| ${label} | ${pct(bb.maxDDPct.p50)} | ${pct(bb.maxDDPct.p90)} | ${pct(bb.maxDDPct.p95)} | ${pct(bb.maxDDPct.p99)} | ${pct(probMaxDDAtLeast(bb, 20) * 100, 0)} | ${pct(probMaxDDAtLeast(bb, 30) * 100, 0)} |`;
  // Old iid trade resample, kept only to show how much it understates tails.
  const boot = bootstrapTradeSequence(port.trades, { startEquity: args.equity, runs: 2000, seed: 1 });

  // Sign-flip test: only "mean trade P&L > 0" — drift alone passes it.
  const perm = permutationEdgeTest(port.trades, { runs: 2000, seed: 1 });

  // Timing-skill test: drift-preserving joint bar permutation. Statistic =
  // closed-trade mean R of backtestPortfolio with the SAME config as above.
  const permRuns = args.permRuns ?? (args.selftest ? 0 : 199);
  let barPerm = null;
  if (permRuns > 0) {
    console.log(`\n  bar permutation: ${permRuns} runs (block ${args.permBlock}d)...`);
    const t0 = Date.now();
    barPerm = barPermutationTest({
      dailyByAsset, weeklyByAsset, runs: permRuns, seed: 1, block: args.permBlock, startTime: startSec,
      runStat: (d) => closedMeanR(backtestPortfolio({ ...d, startEquity: args.equity, riskPct: args.risk, feePct: args.fee, slippagePct: args.slip, fundingByAsset, signalParams: sigParams, regimeParams: regParams, exitOnRegimeFlip: exitFlip }).trades),
    });
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // assemble report
  const md = [
    `# Backtest report — ${stamp}`,
    "",
    `- Mode: ${args.selftest ? "SELF-TEST (synthetic data — numbers are meaningless, this only proves the pipeline runs)" : "Binance live history"}${modeNote}`,
    `- Universe: ${loaded.join(", ")}`,
    `- From: ${args.from} | To: ${args.to ? `${args.to} (exclusive)` : `latest available (last bar ${lastBarDate}) — pass --to to make this run reproducible`}`,
    `- Risk: ${args.risk}% | Fee: ${args.fee}% per side | Slippage: ${args.slip}% per fill | Start equity: ${f(args.equity, 0)}`,
    `- Data sha256: \`${dataSha}\` (daily + weekly + funding as loaded; same hash = same inputs)`,
    "",
    "## Execution assumptions (read before trusting any number)",
    "",
    "```",
    "Signal candles:    Binance spot, UTC daily / weekly",
    "Weekly regime:     last FULLY COMPLETED weekly candle only (no partial week)",
    "Donchian lookback: EXCLUDES the current signal candle (uses bars up to i-1)",
    "Signal evaluation: at daily close",
    "Entry fill:        NEXT bar's open + adverse slippage (never the signal close)",
    "Exit fill:         next executable price, gap-aware (worse of stop vs open) + slippage",
    `Fees:              ${args.fee}% per side (charged on entry AND exit notional)`,
    `Slippage:          ${args.slip}% per fill (see cost-sensitivity table)`,
    "Same-bar order:    stop checked BEFORE regime-flip (pessimistic, deterministic)",
    "Funding:           Binance USDT-M perp funding history, summed per UTC day and",
    "                   charged against notional at that day's close while held",
    "                   (longs pay positive funding, shorts receive it)",
    "End-of-data:       open positions marked to market and tagged 'end of data',",
    "                   reported separately from realized closed trades",
    "```",
    "",
    "## Single-asset results",
    "",
    "| Asset | Trades | Win% | Exp(R) | PF | Return% | MaxDD% | CAGR |",
    "|---|---|---|---|---|---|---|---|",
    ...singleRows,
    "",
    "## Portfolio (all portfolio rules applied)",
    "",
    `- Trades: ${portMetrics.numTrades}`,
    `- Win rate: ${pct(portMetrics.winRate * 100)}`,
    `- Expectancy: ${f(portMetrics.expectancyR, 2)} R`,
    `- Profit factor: ${portMetrics.profitFactor === Infinity ? "∞" : f(portMetrics.profitFactor, 2)}`,
    `- Total return: ${pct(portMetrics.totalReturnPct)}`,
    `- CAGR: ${pct(portMetrics.cagr)}`,
    `- Max drawdown: ${pct(portMetrics.maxDDPct)} over ${f(portMetrics.maxDDDays, 0)} days`,
    "",
    `Realized closed trades only (excluding ${forcedClosed} forced end-of-data closes): `
      + `${realizedMetrics.numTrades} trades, win ${pct(realizedMetrics.winRate * 100)}, `
      + `expectancy ${f(realizedMetrics.expectancyR, 2)}R, PF `
      + `${realizedMetrics.profitFactor === Infinity ? "∞" : f(realizedMetrics.profitFactor, 2)}.`,
    "",
    `Funding: covered on ${fundingCovered}/${loaded.length} assets. Net funding paid across all `
      + `trades: ${f(totalFunding, 0)} USDT (positive = drag on returns).`,
    "",
    "## Long vs short (judge separately — crypto is not symmetric)",
    "",
    "| Book | Trades | Win% | Exp(R) | PF | Net P&L |",
    "|---|---|---|---|---|---|",
    `| LONG | ${longM.numTrades} | ${pct(longM.winRate * 100)} | ${f(longM.expectancyR, 2)} | ${longM.profitFactor === Infinity ? "∞" : f(longM.profitFactor, 2)} | ${f(longTrades.reduce((s, t) => s + t.pnl, 0), 0)} |`,
    `| SHORT | ${shortM.numTrades} | ${pct(shortM.winRate * 100)} | ${f(shortM.expectancyR, 2)} | ${shortM.profitFactor === Infinity ? "∞" : f(shortM.profitFactor, 2)} | ${f(shortTrades.reduce((s, t) => s + t.pnl, 0), 0)} |`,
    "",
    "A valid outcome is one side working and the other not. Do not keep the losing",
    "side for symmetry's sake.",
    "",
    "## Benchmarks (same timeline, same costs, scored identically)",
    "",
    `Daily mark-to-market curves; Sharpe = mean/sd of daily returns × √365 (rf = 0). Costs on traded notional: ${args.fee}%/side + ${args.slip}% slippage. Buy-and-hold sleeves sit in cash until their coin's first bar.`,
    "",
    "| Strategy | Return% | CAGR | MaxDD% | Vol% (ann.) | Sharpe |",
    "|---|---|---|---|---|---|",
    statsRow("**This system (portfolio, all costs)**", systemStats),
    ...benchmarks.map((b) => statsRow(b.name, b.stats)),
    "",
    "The system must beat these on a RISK-ADJUSTED basis (Sharpe, drawdown), not",
    "necessarily on raw return. Regime-hold is the key control: it is the same",
    "weekly 50W-SMA filter with NO Donchian timing. If the system does not beat it,",
    "the entry/exit timing adds nothing over simply holding what is above its SMA.",
    "",
    "## Cost sensitivity (portfolio)",
    "",
    "If the edge only survives the optimistic row, it is not a real edge.",
    "",
    "| Slippage scenario | Trades | Exp(R) | Return% | MaxDD% |",
    "|---|---|---|---|---|",
    ...scenarios,
    "",
    "## Sub-period stability (NOT out-of-sample: the rules were selected on this same history)",
    "",
    "Single-asset, frozen preset, consecutive 6-month windows (after a 2-year lead-in).",
    "Nothing is fitted per window, so this only shows whether the result is spread",
    "across time or concentrated in one stretch. It is not evidence against overfitting —",
    "paper trading is the only true out-of-sample.",
    "",
    "| Asset | 6-mo periods | Periods with Exp(R) > 0 (of those with trades) | Exp(R) over periods | MaxDD% over periods |",
    "|---|---|---|---|---|",
    ...wfRows,
    "",
    "## Drawdown planning (stationary block bootstrap of daily MTM returns)",
    "",
    `Portfolio daily mark-to-market returns at ${args.risk}% risk per trade, resampled in blocks (mean 30 days, Politis-Romano), 5000 paths of ${bbFull.horizon} days. "Half drift" removes half the historical mean daily return.`,
    "",
    "| Assumption | MaxDD p50 | p90 | p95 | p99 | P(DD ≥ 20%) | P(DD ≥ 30%) |",
    "|---|---|---|---|---|---|---|",
    ddRow("History as-is", bbFull),
    ddRow("Half drift", bbHalf),
    "",
    `For reference only: the iid closed-trade dollar resample gives p95 maxDD ${pct(boot.maxDDPct.p95)}. It ignores open-trade swings and serial dependence and on real data has understated tail drawdown — do not plan with it.`,
    "",
    "## Statistical tests",
    "",
    "### Bar permutation (timing skill)",
    "",
    barPerm
      ? [
        `Same rules and costs re-run on ${barPerm.runs} drift-preserving joint permutations of daily bars from ${args.from}-01-01 (block ${barPerm.block}d): each coin keeps its total return and each day keeps its cross-asset move; only the ORDER is shuffled. Statistic = closed-trade mean R.`,
        "",
        `- Observed: ${f(barPerm.observed, 3)} R | null median: ${f(barPerm.nullMedian, 3)} R | null p95: ${f(barPerm.nullP95, 3)} R`,
        `- Timing component (observed − null median): ${f(barPerm.timing, 3)} R`,
        `- p = ${f(barPerm.p, 4)} (= (1 + #null ≥ observed) / (1 + ${barPerm.runs - barPerm.invalid}))${barPerm.invalid ? `; ${barPerm.invalid} invalid runs dropped` : ""}`,
        "",
        "p < 0.05 with a positive timing component = the rules' timing beats the same days in random order. The null median is what drift alone earns.",
      ].join("\n")
      : "Skipped (self-test default). Pass `--perm-runs N` to run it.",
    "",
    "### Sign-flip test (mean trade P&L > 0 only)",
    "",
    `- p = ${f(perm.p, 4)} (real mean trade ${f(perm.realExpectancy, 2)} vs sign-flipped mean ${f(perm.permutedMean, 2)})`,
    "- Tests only that the average trade made money. It does NOT separate timing skill from",
    "  drift: a long-only system with no timing skill passes whenever the market rose.",
    "",
    "## How to read this",
    "",
    "1. Expectancy(R) positive across most assets = the rules made money in this period.",
    "2. Sub-period stability mostly positive = the result is not one lucky stretch. It is NOT out-of-sample.",
    "3. Block-bootstrap p95 max drawdown (and the half-drift row) = what to be ready to sit through.",
    "4. Bar-permutation p < 0.05 with a positive timing component = the timing is doing work beyond drift.",
    "5. Beating regime-hold on Sharpe and drawdown = the Donchian layer earns its complexity.",
    "",
    "If the bar-permutation p is high or the system loses to regime-hold, the backtest",
    "is mostly measuring the market's drift — not an edge in the rules.",
    "",
  ].join("\n");

  const strip = ({ samples: _s, ...rest }) => rest;
  const json = {
    stamp, args, dataSha256: dataSha, lastBarDate, single,
    portfolio: { metrics: portMetrics, stats: systemStats, trades: port.trades },
    benchmarks,
    montecarlo: {
      blockBootstrap: { full: strip(bbFull), halfDrift: strip(bbHalf) },
      tradeBootstrap: { returnsPct: boot.returnsPct, maxDDPct: boot.maxDDPct },
      signFlip: perm,
      barPermutation: barPerm,
    },
  };

  const mdPath = join(REPORTS_DIR, `backtest-${stamp}.md`);
  const jsonPath = join(REPORTS_DIR, `backtest-${stamp}.json`);
  writeFileSync(mdPath, md);
  writeFileSync(jsonPath, JSON.stringify(json, null, 2));

  console.log("\n" + md);
  console.log(`\nWrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
