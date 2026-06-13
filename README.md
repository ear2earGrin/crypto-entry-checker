# Crypto Entry Checker

Mechanical swing-trading system for crypto futures, with discretionary pre-trade gating.
React + Vite, no backend, all data via Binance public endpoints (proxied through Vite).

## Read these first

If you're a person picking this up after a break, or an AI assistant continuing the work:

1. **[docs/STRATEGY-SPEC.md](docs/STRATEGY-SPEC.md)** — the rules, in detail. Single source of truth. If code conflicts with this doc, the code has a bug.
2. **[docs/AGENT-HANDOFF.md](docs/AGENT-HANDOFF.md)** — instructions for the next AI assistant. Captures design rationale, known traps, and what's deliberately *not* implemented.
3. **[docs/ROUTINE.md](docs/ROUTINE.md)** — the owner's daily / weekly checklist. Mechanical trading only works if you mechanically run it.

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
npm run dev        # http://localhost:5173
npm test           # 100+ tests, all should pass
npm run build      # production build
npm run lint
```

## Methodological guarantees

The backtest engine and metrics are designed to *not* fool you:

- **Walk-forward** (`src/backtest/walkforward.js`) — tunes on 2-year in-sample, evaluates on forward 6-month out-of-sample, reports degradation. > 60% degradation = your edge is overfitting.
- **Monte Carlo** (`src/backtest/montecarlo.js`) — bootstraps your trade list 2000 times to estimate the range of realistic outcomes; permutation test for whether the edge is statistically distinguishable from luck.
- **Portfolio backtest** (`src/backtest/portfolio.js`) — multi-asset replay that actually respects correlation caps, daily entry limits, and re-entry cooldowns. Single-asset numbers are *not* portfolio numbers; trust this engine, not the single-asset one, when evaluating the live system.
- **Property-based indicator tests** (`src/indicators/__tests__/properties.test.js`) — fast-check verifies invariants on randomized inputs so a successor model cannot silently break the math.
- **Live unclosed candle is always dropped** — never read forming data. If you "fix" this to include the current bar, every backtest is silently invalid.

## What this system isn't

- It's not a money-printer. Expected: 30-45% win rate, 20-35% max drawdown.
- It's not a prediction engine. It tells you what the rules say *right now*, not what's going to happen.
- It's not an auto-trader. You take the trades. The point is that the *decision* is mechanical, not the *execution*.

See `docs/STRATEGY-SPEC.md` §12 (non-goals) and `docs/AGENT-HANDOFF.md` §3 (tempting changes and why not).
