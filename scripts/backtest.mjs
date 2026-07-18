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
 *   - walk-forward on each asset (in-sample/out-of-sample, degradation)
 *   - Monte Carlo on the portfolio trade list (outcome distribution + edge p-value)
 * and writes a timestamped Markdown + JSON report into reports/.
 *
 * Usage:
 *   node scripts/backtest.mjs                         # full run, universe, from 2020
 *   node scripts/backtest.mjs --from 2021 --asset BTC # single asset
 *   node scripts/backtest.mjs --risk 0.5 --fee 0.1
 *   node scripts/backtest.mjs --selftest             # synthetic data, no network
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
import { computeMetrics } from "../src/backtest/metrics.js";
import { bootstrapTradeSequence, permutationEdgeTest } from "../src/backtest/montecarlo.js";
import { PRESET_V1, PRESET_V2 } from "../src/strategy/presets.js";
import { UNIVERSE, loadAsset, loadFunding, synth, synthFunding, f, pct } from "./lib/data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, "..", "reports");

// ---------- args ----------
function parseArgs(argv) {
  const a = { from: 2020, risk: 1, fee: 0.08, slip: 0.05, equity: 100000, asset: null, selftest: false, longOnly: false, preset: "v2" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--selftest") a.selftest = true;
    else if (k === "--long-only") a.longOnly = true;
    else if (k === "--preset") a.preset = String(argv[++i]);
    else if (k === "--from") a.from = Number(argv[++i]);
    else if (k === "--risk") a.risk = Number(argv[++i]);
    else if (k === "--fee") a.fee = Number(argv[++i]);
    else if (k === "--slip") a.slip = Number(argv[++i]);
    else if (k === "--equity") a.equity = Number(argv[++i]);
    else if (k === "--asset") a.asset = String(argv[++i]).toUpperCase();
  }
  return a;
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
  const assets = args.asset ? [args.asset] : UNIVERSE;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  console.log(`\nBacktest harness — ${args.selftest ? "SELF-TEST (synthetic)" : "Binance data"}`);
  console.log(`Universe: ${assets.join(", ")} | from ${args.from} | risk ${args.risk}% | fee ${args.fee}% | slip ${args.slip}%\n`);

  const data = {};
  const fundingByAsset = {};
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    try {
      data[asset] = args.selftest ? synth(asset, i * 1.7) : await loadAsset(asset, args.from);
      console.log(`  loaded ${asset}: ${data[asset].daily.length} daily, ${data[asset].weekly.length} weekly`);
    } catch (e) {
      console.error(`  FAILED ${asset}: ${e.message}`);
      continue;
    }
    // Funding is best-effort: a perp may be younger than the spot history, or the
    // endpoint may fail — either way the price backtest still runs, with funding
    // coverage disclosed in the report.
    try {
      fundingByAsset[asset] = args.selftest ? synthFunding() : await loadFunding(asset, args.from);
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

  const benchRows = loaded.map((a) => {
    const d = data[a].daily;
    const ret = d.length > 1 ? ((d[d.length - 1].close / d[0].close) - 1) * 100 : 0;
    return { a, ret };
  });
  const eqWeightRet = benchRows.reduce((s, b) => s + b.ret, 0) / (benchRows.length || 1);
  const btcRet = benchRows.find((b) => b.a === "BTC")?.ret ?? null;

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

  // walk-forward per asset
  const wfRows = [];
  for (const asset of loaded) {
    const wf = walkForward({ ...data[asset], asset, startEquity: args.equity, riskPct: args.risk, feePct: args.fee, slippagePct: args.slip, funding: fundingByAsset[asset], signalParams: sigParams, regimeParams: regParams, exitOnRegimeFlip: exitFlip });
    const s = wf.summary;
    wfRows.push(`| ${asset} | ${s.numFolds ?? 0} | ${f(s.oosExpectancyR, 2)} | ${pct(s.oosMaxDDPct)} | ${s.degradation === null ? "-" : pct(s.degradation)} |`);
  }

  // monte carlo on portfolio trades
  const boot = bootstrapTradeSequence(port.trades, { startEquity: args.equity, runs: 2000, seed: 1 });
  const perm = permutationEdgeTest(port.trades, { runs: 2000, seed: 1 });

  // assemble report
  const md = [
    `# Backtest report — ${stamp}`,
    "",
    `- Mode: ${args.selftest ? "SELF-TEST (synthetic data — numbers are meaningless, this only proves the pipeline runs)" : "Binance live history"}${modeNote}`,
    `- Universe: ${loaded.join(", ")}`,
    `- From: ${args.from} | Risk: ${args.risk}% | Fee: ${args.fee}% round-trip | Slippage: ${args.slip}% per fill | Start equity: ${f(args.equity, 0)}`,
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
    `Fees:              ${args.fee}% round-trip`,
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
    "## Benchmarks (same period, buy-and-hold)",
    "",
    `- BTC buy-and-hold: ${btcRet === null ? "n/a" : pct(btcRet)}`,
    `- Equal-weight universe buy-and-hold: ${pct(eqWeightRet)}`,
    `- This system (portfolio, all costs): ${pct(portMetrics.totalReturnPct)} with ${pct(portMetrics.maxDDPct)} max DD`,
    "",
    "The system must beat these on a RISK-ADJUSTED basis (return vs drawdown), not",
    "necessarily on raw return — otherwise just hold and skip the work.",
    "",
    "## Cost sensitivity (portfolio)",
    "",
    "If the edge only survives the optimistic row, it is not a real edge.",
    "",
    "| Slippage scenario | Trades | Exp(R) | Return% | MaxDD% |",
    "|---|---|---|---|---|",
    ...scenarios,
    "",
    "## Walk-forward (per asset, 2y in-sample / 6mo out-of-sample)",
    "",
    "Degradation = average drop from in-sample to out-of-sample expectancy. < 30% healthy, > 60% overfit.",
    "",
    "| Asset | Folds | OOS Exp(R) | OOS MaxDD% | Degradation |",
    "|---|---|---|---|---|",
    ...wfRows,
    "",
    "## Monte Carlo (portfolio trades, 2000 runs)",
    "",
    "Bootstrap resampling of the trade sequence — the realistic range of outcomes, not just the one curve you got.",
    "",
    `- Return p05 / p50 / p95: ${pct(boot.returnsPct.p05)} / ${pct(boot.returnsPct.median)} / ${pct(boot.returnsPct.p95)}`,
    `- Max drawdown p50 / p95: ${pct(boot.maxDDPct.median)} / ${pct(boot.maxDDPct.p95)}`,
    `- Permutation edge test p-value: ${f(perm.p, 4)} (real expectancy ${f(perm.realExpectancy, 2)} vs permuted mean ${f(perm.permutedMean, 2)})`,
    `  - p < 0.05 = statistical evidence of edge; higher = could be luck`,
    "",
    "## How to read this",
    "",
    "1. Expectancy(R) positive across most assets = the rule has edge in this period.",
    "2. Walk-forward degradation low = the edge is not just curve-fitting.",
    "3. Monte Carlo p95 max drawdown = the worst you should mentally prepare to sit through.",
    "4. Permutation p < 0.05 = the result is unlikely to be random luck.",
    "",
    "If all four hold, the system is worth paper-trading. If walk-forward degrades badly",
    "or the permutation p-value is high, do NOT trade it — the backtest is fooling you.",
    "",
  ].join("\n");

  const json = { stamp, args, single, portfolio: { metrics: portMetrics, trades: port.trades }, montecarlo: { boot, perm } };

  const mdPath = join(REPORTS_DIR, `backtest-${stamp}.md`);
  const jsonPath = join(REPORTS_DIR, `backtest-${stamp}.json`);
  writeFileSync(mdPath, md);
  writeFileSync(jsonPath, JSON.stringify(json, null, 2));

  console.log("\n" + md);
  console.log(`\nWrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
