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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, "..", "reports");

const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const BINANCE = "https://api.binance.com";

// ---------- args ----------
function parseArgs(argv) {
  const a = { from: 2020, risk: 1, fee: 0.08, equity: 100000, asset: null, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--selftest") a.selftest = true;
    else if (k === "--from") a.from = Number(argv[++i]);
    else if (k === "--risk") a.risk = Number(argv[++i]);
    else if (k === "--fee") a.fee = Number(argv[++i]);
    else if (k === "--equity") a.equity = Number(argv[++i]);
    else if (k === "--asset") a.asset = String(argv[++i]).toUpperCase();
  }
  return a;
}

// ---------- data ----------
function toCandles(raw) {
  return raw
    .map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Math.floor(Number(k[6]) / 1000),
      takerBuyBase: Number(k[9]),
    }))
    .filter((c) => Number.isFinite(c.close));
}

async function fetchKlinesRange(symbol, interval, startMs, endMs = Date.now()) {
  const all = [];
  let cursor = startMs;
  for (let guard = 0; guard < 80; guard++) {
    const url = `${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${(await res.text()).slice(0, 120)}`);
    const batch = toCandles(await res.json());
    if (batch.length === 0) break;
    all.push(...batch);
    const lastMs = (batch[batch.length - 1].closeTime || batch[batch.length - 1].time) * 1000;
    if (batch.length < 1000 || lastMs >= endMs) break;
    cursor = lastMs + 1;
  }
  const seen = new Set();
  return all.filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)));
}

function dropUnclosed(candles) {
  if (!candles.length) return candles;
  const now = Math.floor(Date.now() / 1000);
  const last = candles[candles.length - 1];
  return last.closeTime && last.closeTime > now ? candles.slice(0, -1) : candles;
}

async function loadAsset(asset, fromYear) {
  const symbol = `${asset}USDT`;
  const start = Date.UTC(fromYear, 0, 1);
  const weeklyStart = start - 55 * 7 * 86400 * 1000; // warm the 50W SMA
  const [weekly, daily] = await Promise.all([
    fetchKlinesRange(symbol, "1w", weeklyStart),
    fetchKlinesRange(symbol, "1d", start),
  ]);
  return { weekly: dropUnclosed(weekly), daily: dropUnclosed(daily) };
}

// ---------- synthetic data for --selftest ----------
function synth(asset, seed) {
  const ONE_DAY = 86400, ONE_WEEK = ONE_DAY * 7;
  const wn = 230, dn = 1500; // > 913 days so walk-forward produces folds in self-test
  const wk = Array.from({ length: wn }, (_, i) => 100 + i * 2 + Math.sin(i / 4 + seed) * 9);
  const dl = Array.from({ length: dn }, (_, i) => 100 + i * 0.3 + Math.sin(i / 12 + seed) * 13);
  const t0 = Date.UTC(2020, 0, 1);
  const mk = (arr, step, base) => arr.map((c, i) => ({
    time: base + i * step, closeTime: base + (i + 1) * step - 1,
    open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000, takerBuyBase: 550,
  }));
  return { weekly: mk(wk, ONE_WEEK, t0), daily: mk(dl, ONE_DAY, t0) };
}

// ---------- formatting ----------
const f = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d }) : "-");
const pct = (n, d = 1) => (Number.isFinite(n) ? `${n.toFixed(d)}%` : "-");

function metricsRow(asset, m) {
  return `| ${asset} | ${m.numTrades} | ${pct(m.winRate * 100)} | ${f(m.expectancyR, 2)} | ${m.profitFactor === Infinity ? "∞" : f(m.profitFactor, 2)} | ${pct(m.totalReturnPct)} | ${pct(m.maxDDPct)} | ${pct(m.cagr)} |`;
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const assets = args.asset ? [args.asset] : UNIVERSE;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  console.log(`\nBacktest harness — ${args.selftest ? "SELF-TEST (synthetic)" : "Binance data"}`);
  console.log(`Universe: ${assets.join(", ")} | from ${args.from} | risk ${args.risk}% | fee ${args.fee}%\n`);

  const data = {};
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    try {
      data[asset] = args.selftest ? synth(asset, i * 1.7) : await loadAsset(asset, args.from);
      console.log(`  loaded ${asset}: ${data[asset].daily.length} daily, ${data[asset].weekly.length} weekly`);
    } catch (e) {
      console.error(`  FAILED ${asset}: ${e.message}`);
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
    const bt = backtestOne({ asset, ...data[asset], startEquity: args.equity, riskPct: args.risk, feePct: args.fee });
    const m = computeMetrics(bt);
    single[asset] = { metrics: m, trades: bt.trades };
    singleRows.push(metricsRow(asset, m));
  }

  // portfolio
  const dailyByAsset = {}, weeklyByAsset = {};
  for (const asset of loaded) { dailyByAsset[asset] = data[asset].daily; weeklyByAsset[asset] = data[asset].weekly; }
  const port = backtestPortfolio({ dailyByAsset, weeklyByAsset, startEquity: args.equity, riskPct: args.risk, feePct: args.fee });
  const portMetrics = computeMetrics(port);

  // walk-forward per asset
  const wfRows = [];
  for (const asset of loaded) {
    const wf = walkForward({ ...data[asset], asset, startEquity: args.equity, riskPct: args.risk, feePct: args.fee });
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
    `- Mode: ${args.selftest ? "SELF-TEST (synthetic data — numbers are meaningless, this only proves the pipeline runs)" : "Binance live history"}`,
    `- Universe: ${loaded.join(", ")}`,
    `- From: ${args.from} | Risk: ${args.risk}% | Fee: ${args.fee}% round-trip | Start equity: ${f(args.equity, 0)}`,
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
