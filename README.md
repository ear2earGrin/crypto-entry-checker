# Crypto Entry Checker

A deterministic pre-trade gating tool for crypto. Blocks bad trades; it does not find trades. Pulls Binance public data (no API keys), scores macro + BTC-led derivatives stress, sizes the position, and approximates liquidation. Built with React + Vite + lightweight-charts.

## Features

- Execution-mode-aware checks (MARKET vs LIMIT) with timeframe-specific edge proximity and R:R thresholds.
- Macro catalyst scoring (FOMC, CPI, NFP, etc.) with time-to-event and density multipliers.
- BTC-led derivatives stress (funding rate, OI 24h delta, long/short ratio) from Binance futures.
- Position sizing + liquidation approximation + stop-to-liq buffer enforcement.
- Embedded chart with click-to-set Entry / Stop / Target.
- One-click journal note for trade-log discipline.

## Quick start

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

The Vite config proxies:
- `/binance-spot` → `https://api.binance.com`
- `/binance-fut` → `https://fapi.binance.com`

## Docs

- [Claude Code + TradingView MCP setup guide](./docs/CLAUDE_TRADINGVIEW_GUIDE.md) — optional power-user workflow for chart-aware AI technical analysis alongside this checker.

## Disclaimer

Analysis output is for educational use. Liquidation math is an approximation. Markets are risky — size accordingly.
