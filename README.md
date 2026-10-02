# Crypto Entry Checker

Mechanical swing-trading system for crypto futures, with discretionary pre-trade gating.
React + Vite, no backend, all data via Binance public endpoints (proxied through Vite).

## Read these first

If you're a person picking this up after a break, or an AI assistant continuing the work:

1. **[docs/STRATEGY-SPEC.md](docs/STRATEGY-SPEC.md)** — the rules, in detail. Single source of truth. If code conflicts with this doc, the code has a bug.
2. **[docs/AGENT-HANDOFF.md](docs/AGENT-HANDOFF.md)** — instructions for the next AI assistant. Captures design rationale, known traps, and what's deliberately *not* implemented.
3. **[docs/ROUTINE.md](docs/ROUTINE.md)** — the owner's daily / weekly checklist. Mechanical trading only works if you mechanically run it.
4. **[docs/INTEGRATION-INTO-PM-BRIEF.md](docs/INTEGRATION-INTO-PM-BRIEF.md)** — porting guide for embedding this app as a subsection of pm-brief.com (or any other host app). Includes framework-specific adaptations and the CORS-proxy gotcha.

## Routes

| Path | What it does |
|---|---|
| `/` | Discretionary CHECKER — pre-trade gate with macro + derivatives + sizing for trades you're considering taking by judgment |
| `/scanner` | SCANNER — once-a-day output: per asset, what does the mechanical system say right now |
| `/backtest` | BACKTEST — single-asset historical replay with equity curve and 12-metric grid |
| `/log` | TRADE LOG — persisted trade journal with Obsidian-flavored Markdown export |
| `/lore` | World lore (unrelated to trading; existing app feature) |

## Architecture

```
src/
  indicators/       pure functions: SMA EMA RMA MACD RSI ATR ADX Donchian Bollinger
  strategy/         pure rule logic: regime · signal · exit · sizing · portfolio
  backtest/         engine (1-asset) · portfolio (multi-asset) · walkforward · montecarlo · metrics
  data/             binance.js (kline fetch) · tradeLog.js (persistence + obsidian md)
  pages/            Scanner · Backtest · TradeLog · App (CHECKER) · LorePage
  components/       Nav
docs/               STRATEGY-SPEC · AGENT-HANDOFF · ROUTINE
```

Indicators and rules are pure functions of inputs only. UI consumes them; tests verify
their math directly. This is the load-bearing separation — keep it.

## Quick commands

```bash
npm install
npm run dev               # http://localhost:5173
npm test                  # 115 tests, all should pass
npm run build             # production build
npm run lint
npm run backtest          # headless wind-tunnel: whole universe, benchmarks,
                          # sub-period stability, drawdown bootstrap, permutation
                          # tests → writes reports/backtest-<date>.md + .json
npm run backtest -- --from 2021 --asset BTC --risk 0.5   # flags pass through
npm run backtest -- --to 2026-07-18 --perm-runs 999      # reproducible end date
npm run backtest:selftest # synthetic data, no network — proves the pipeline runs
```

The headless backtest (`scripts/backtest.mjs`) imports the **same** pure
indicator/strategy/backtest modules the UI uses, so there is zero drift between
what you validate and what the Scanner shows live. It runs single-asset +
portfolio backtests, risk-adjusted benchmarks, per-asset sub-period stability,
a block-bootstrap drawdown distribution and two permutation tests, then writes a
Markdown + JSON report stamped with the data's sha256 (pin the window with
`--to YYYY-MM-DD` to reproduce a run). This is the "wind tunnel": run it before
trusting any signal.

## Methodological guarantees

The backtest engine and metrics are designed to *not* fool you:

- **Sub-period stability** (`src/backtest/walkforward.js`) — the harness runs the frozen preset on consecutive 6-month windows and reports each. Nothing is fitted (no param grid), and the preset was selected on this same history, so this is a stability check, **not** out-of-sample evidence; paper trading is the out-of-sample.
- **Bar-permutation test** (`barPermutationTest` in `src/backtest/montecarlo.js`) — re-runs the portfolio on drift-preserving joint permutations of daily bars (each coin keeps its total return, each day keeps its cross-asset move, only the order changes). Reports p and the timing component (observed − null median closed-trade mean R). This is the test for timing skill. The older sign-flip test (`permutationEdgeTest`) only checks mean trade P&L > 0 and is passed by drift alone.
- **Drawdown bootstrap** (`blockBootstrapMaxDrawdown`) — stationary block bootstrap of the portfolio's daily mark-to-market returns; p50/p90/p95/p99 max drawdown, also with half the historical drift.
- **Benchmarks** (`src/backtest/benchmarks.js`) — BTC and equal-weight buy-and-hold plus "regime-hold" (hold each coin whose last closed weekly close is above its 50W SMA, weekly rebalance), all with Sharpe, vol and max drawdown on the same timeline and costs.
- **Portfolio backtest** (`src/backtest/portfolio.js`) — multi-asset replay that actually respects correlation caps, daily entry limits, and re-entry cooldowns. Single-asset numbers are *not* portfolio numbers; trust this engine, not the single-asset one, when evaluating the live system.
- **Property-based indicator tests** (`src/indicators/__tests__/properties.test.js`) — fast-check verifies invariants on randomized inputs so a successor model cannot silently break the math.
- **Live unclosed candle is always dropped** — never read forming data. If you "fix" this to include the current bar, every backtest is silently invalid.

## What this system isn't

- It's not a money-printer. Expected: 30-45% win rate, 20-35% max drawdown.
- It's not a prediction engine. It tells you what the rules say *right now*, not what's going to happen.
- It's not an auto-trader. You take the trades. The point is that the *decision* is mechanical, not the *execution*.

See `docs/STRATEGY-SPEC.md` §12 (non-goals) and `docs/AGENT-HANDOFF.md` §3 (tempting changes and why not).
