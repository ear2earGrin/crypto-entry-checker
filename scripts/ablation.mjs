#!/usr/bin/env node
/**
 * Ablation harness — answers the single most important question about this system:
 * do the weekly confluence conditions and the anti-chase filters create genuine
 * robustness, or are they a sophisticated way to miss the best trends?
 *
 * It runs a SMALL set of PREDECLARED strategy variants (no fishing) and reports,
 * for each, the metrics that actually matter for a trend system — including the
 * right-tail capture (share of profit from the biggest winners and the largest
 * R-multiple). A filter that lifts win rate but kills the five biggest trends is
 * psychologically attractive and financially inferior; this surfaces exactly that.
 *
 * Usage:
 *   node scripts/ablation.mjs --asset BTC --from 2020
 *   node scripts/ablation.mjs --selftest        # synthetic data, no network
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { backtestOne } from "../src/backtest/engine.js";
import { computeMetrics } from "../src/backtest/metrics.js";
import { REGIME_PARAMS } from "../src/strategy/regime.js";
import { SIGNAL_PARAMS } from "../src/strategy/signal.js";
import { UNIVERSE, loadAsset, synth, f, pct } from "./lib/data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, "..", "reports");

function parseArgs(argv) {
  const a = { from: 2020, risk: 1, fee: 0.08, slip: 0.05, equity: 100000, asset: null, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--selftest") a.selftest = true;
    else if (k === "--from") a.from = Number(argv[++i]);
    else if (k === "--risk") a.risk = Number(argv[++i]);
    else if (k === "--fee") a.fee = Number(argv[++i]);
    else if (k === "--slip") a.slip = Number(argv[++i]);
    else if (k === "--asset") a.asset = String(argv[++i]).toUpperCase();
  }
  return a;
}

// Build a (regimeParams, signalParams) pair from a compact spec.
function variant(name, { use = null, ignoreRegime = false, rsiVeto = false, bbVeto = false, exitOnRegimeFlip = true, donchian = null, allowShort = true }) {
  const regimeParams = { ...REGIME_PARAMS, use: use || { sma: false, macd: false, rsi: false, adx: false } };
  const signalParams = { ...SIGNAL_PARAMS, ignoreRegime, useRsiVeto: rsiVeto, useBbVeto: bbVeto, allowShort };
  if (donchian) {
    signalParams.donchianEntry = donchian[0];
    signalParams.donchianExit = donchian[1];
  }
  return { name, regimeParams, signalParams, exitOnRegimeFlip };
}

// PREDECLARED variants — do not expand this list during a run (that would be fishing).
const VARIANTS = [
  variant("1. Donchian only (no regime, no filters)", { ignoreRegime: true }),
  variant("2. + SMA regime", { use: { sma: true, macd: false, rsi: false, adx: false } }),
  variant("3. + ADX", { use: { sma: true, macd: false, rsi: false, adx: true } }),
  variant("4. + MACD", { use: { sma: true, macd: true, rsi: false, adx: true } }),
  variant("5. + RSI (= full regime, no anti-chase)", { use: { sma: true, macd: true, rsi: true, adx: true } }),
  variant("6. Full regime + RSI veto", { use: { sma: true, macd: true, rsi: true, adx: true }, rsiVeto: true }),
  variant("7. Full regime + BB veto", { use: { sma: true, macd: true, rsi: true, adx: true }, bbVeto: true }),
  variant("8. PRODUCTION (full regime + both vetoes)", { use: { sma: true, macd: true, rsi: true, adx: true }, rsiVeto: true, bbVeto: true }),
  // leave-one-out from production
  variant("9. Prod minus SMA", { use: { sma: false, macd: true, rsi: true, adx: true }, rsiVeto: true, bbVeto: true }),
  variant("10. Prod minus MACD", { use: { sma: true, macd: false, rsi: true, adx: true }, rsiVeto: true, bbVeto: true }),
  variant("11. Prod minus RSI(regime)", { use: { sma: true, macd: true, rsi: false, adx: true }, rsiVeto: true, bbVeto: true }),
  variant("12. Prod minus ADX", { use: { sma: true, macd: true, rsi: true, adx: false }, rsiVeto: true, bbVeto: true }),
  // Exit-rule ablation: weekly MACD hist can flicker mid-trend; does force-closing
  // on regime flips protect us, or eject us from trades the trail would have ridden?
  variant("13. Prod, trail-only exit (no regime-flip exit)", { use: { sma: true, macd: true, rsi: true, adx: true }, rsiVeto: true, bbVeto: true, exitOnRegimeFlip: false }),
  // Slower Turtle family — the only alternate parameter set predeclared for comparison.
  variant("14. Prod with Donchian 55/20", { use: { sma: true, macd: true, rsi: true, adx: true }, rsiVeto: true, bbVeto: true, donchian: [55, 20] }),
  // Follows the predeclared long/short decision rule after the first real-data
  // report showed the short book at PF 0.93: measure the long-only book cleanly.
  variant("15. Prod LONG-ONLY", { use: { sma: true, macd: true, rsi: true, adx: true }, rsiVeto: true, bbVeto: true, allowShort: false }),
];

// Right-tail capture: what share of gross profit came from the top-5 winners, and
// the single biggest R-multiple. Trend systems must keep the big winners.
function rightTail(trades, startEquity) {
  const wins = trades.filter((t) => t.pnl > 0).sort((a, b) => b.pnl - a.pnl);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const top5 = wins.slice(0, 5).reduce((s, t) => s + t.pnl, 0);
  const top5Share = grossProfit > 0 ? (top5 / grossProfit) * 100 : 0;
  const biggestR = trades.reduce((m, t) => Math.max(m, t.rMultiple || -Infinity), -Infinity);

  // Net P&L if you had MISSED the single best and the best-5 trades. If a variant's
  // edge evaporates without its top handful of trades, it is fragile, not robust.
  const totalNet = trades.reduce((s, t) => s + t.pnl, 0);
  const sorted = trades.slice().sort((a, b) => b.pnl - a.pnl);
  const exTop1 = totalNet - (sorted[0]?.pnl || 0);
  const exTop5 = totalNet - sorted.slice(0, 5).reduce((s, t) => s + t.pnl, 0);
  return {
    top5Share,
    biggestR: Number.isFinite(biggestR) ? biggestR : 0,
    retExTop1Pct: (exTop1 / startEquity) * 100,
    retExTop5Pct: (exTop5 / startEquity) * 100,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const assets = args.asset ? [args.asset] : UNIVERSE;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  console.log(`\nAblation — ${args.selftest ? "SELF-TEST (synthetic)" : "Binance data"}`);
  console.log(`Assets: ${assets.join(", ")} | from ${args.from} | risk ${args.risk}% | fee ${args.fee}% | slip ${args.slip}%\n`);

  // Load data once; reuse across all variants.
  const data = {};
  for (let i = 0; i < assets.length; i++) {
    try {
      data[assets[i]] = args.selftest ? synth(assets[i], i * 1.7) : await loadAsset(assets[i], args.from);
      console.log(`  loaded ${assets[i]}: ${data[assets[i]].daily.length} daily`);
    } catch (e) {
      console.error(`  FAILED ${assets[i]}: ${e.message}`);
    }
  }
  const loaded = Object.keys(data);
  if (!loaded.length) { console.error("\nNo data. Off --selftest, check network to api.binance.com.\n"); process.exit(1); }

  // For each variant, aggregate trades across all loaded assets (pooled), so we
  // judge the rule across the universe rather than cherry-picking one symbol.
  const rows = [];
  for (const v of VARIANTS) {
    let allTrades = [];
    let curve = [];
    let eq = args.equity;
    for (const asset of loaded) {
      const bt = backtestOne({
        asset, ...data[asset],
        startEquity: args.equity, riskPct: args.risk, feePct: args.fee, slippagePct: args.slip,
        regimeParams: v.regimeParams, signalParams: v.signalParams,
        exitOnRegimeFlip: v.exitOnRegimeFlip,
      });
      allTrades = allTrades.concat(bt.trades);
      // chain per-asset curves only for a rough pooled equity proxy
      curve = curve.concat(bt.equityCurve);
      eq += bt.finalEquity - args.equity;
    }
    const m = computeMetrics({ trades: allTrades, equityCurve: curve, startEquity: args.equity });
    const rt = rightTail(allTrades, args.equity);
    rows.push({ name: v.name, m, rt });
  }

  const header = "| Variant | Trades | Win% | Exp(R) | PF | Top5 share | Biggest R | Ret ex-top1 | Ret ex-top5 |";
  const sep = "|---|---|---|---|---|---|---|---|---|";
  const body = rows.map((r) =>
    `| ${r.name} | ${r.m.numTrades} | ${pct(r.m.winRate * 100)} | ${f(r.m.expectancyR, 2)} | ${r.m.profitFactor === Infinity ? "∞" : f(r.m.profitFactor, 2)} | ${pct(r.rt.top5Share)} | ${f(r.rt.biggestR, 1)} | ${pct(r.rt.retExTop1Pct)} | ${pct(r.rt.retExTop5Pct)} |`,
  );

  const md = [
    `# Ablation report — ${stamp}`,
    "",
    `- Mode: ${args.selftest ? "SELF-TEST (synthetic — meaningless numbers, proves pipeline only)" : "Binance live history"}`,
    `- Assets pooled: ${loaded.join(", ")} | from ${args.from}`,
    `- Costs: fee ${args.fee}% round-trip, slippage ${args.slip}% per fill`,
    "",
    "Each variant is run on every asset; trades are pooled and scored together.",
    "",
    header, sep, ...body,
    "",
    "## How to read this",
    "",
    "- Compare variant **8 (PRODUCTION)** against **5 (full regime, NO anti-chase)**.",
    "  If 5 has materially higher Exp(R)/PF or a bigger 'Biggest R' and top-5 share,",
    "  the anti-chase filters are removing the trends the system needs — drop them.",
    "- Compare **1 (Donchian only)** against **8**. If the elaborate version isn't",
    "  clearly better (return, drawdown, or robustness), the extra rules are",
    "  comforting complexity, not edge.",
    "- Leave-one-out (9–12): if removing a condition doesn't hurt, that condition",
    "  isn't earning its place.",
    "- A variant that wins ONLY by cutting trade count until a few perfect trades",
    "  remain is overfit, not robust — sanity-check the trade counts.",
    "",
    "This is decision support, not proof. Confirm any change with walk-forward",
    "(npm run backtest) before adopting it into the spec.",
    "",
  ].join("\n");

  writeFileSync(join(REPORTS_DIR, `ablation-${stamp}.md`), md);
  console.log("\n" + md);
  console.log(`\nWrote reports/ablation-${stamp}.md\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
