# Claude Code + TradingView: AI Technical Analysis Setup

An optional power-user workflow that pairs **Claude Code** with the **TradingView desktop app** through a community MCP server. Once connected, Claude can read your charts, indicators, drawings, and alerts to produce structured technical analysis.

> **Heads up.** This relies on a third-party MCP server. Review the source before installing, and treat the output as analysis — not financial advice. Markets are risky; size positions accordingly.

---

## Requirements

- **Claude Code** installed locally
- **Node.js 18+**
- **TradingView Desktop** — https://tradingview.com/desktop
- A **paid TradingView plan** (needed for real-time data)

## 1. Install the TradingView MCP server

Open Claude Code in any project and run:

```
Install the TradingView MCP server. Clone and explore
https://github.com/tradesdontlie/tradingview-mcp, run `npm install`,
add it to my MCP config at ~/.claude/.mcp.json, and launch TradingView
with the debug port enabled.
```

> Inspect the repo before running this — it's community-maintained, not an Anthropic-published server.

## 2. Health check

Restart Claude Code, then run:

```
Use tv_health_check to confirm TradingView is connected.
```

You should get back a confirmation that the MCP can see your TradingView session.

## 3. Run the analysis prompt

With the MCP connected, Claude has access to whatever is loaded in your TradingView environment — charts, indicators, drawings, alerts. Use the prompt below as a starting template:

```
Act as a quantitative trader and technical analyst with full access to
my TradingView environment.

Analyze the current market structure for [ASSET] on these timeframes:
5m, 15m, 1H, 4H, 1D.

Using my existing indicators, drawings, and chart context:
- Identify the current trend and market regime (trending, ranging,
  accumulation, distribution).
- Mark key support and resistance based on price action and liquidity.
- Identify liquidity pools, stop clusters, and likely manipulation zones.
- Analyze momentum (RSI, MACD, volume where available).
- Detect chart patterns (breakouts, consolidations, deviations, etc.).
- Evaluate confluence across timeframes.

Then provide:
- A directional bias (bullish, bearish, neutral).
- The highest-probability setup right now.
- Exact entry, stop loss, take profit levels.
- Risk-to-reward ratio.
- Invalidation point.

Finally:
- Explain reasoning step by step in plain English.
- Avoid generic statements; be decisive.
- If no high-quality setup exists, say "no trade" and explain why.
```

## Tips

- Replace `[ASSET]` with the symbol you have open (e.g. `BTCUSDT`, `ETHUSD`).
- Keep your indicator stack lean — the more cluttered the chart, the noisier the analysis.
- For repeat use, save the prompt as a Claude Code slash command or project memory.

## How this relates to `crypto-entry-checker`

This app gives you a structured entry checklist you can run in the browser. The MCP workflow above is a heavier, optional setup for deeper TA sessions. They're complementary — use the checker for quick gating, the MCP setup when you want chart-aware second opinions.
