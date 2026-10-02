export function computeMetrics({ trades, equityCurve, startEquity }) {
  const n = trades.length;
  if (n === 0) {
    return {
      numTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      expectancy: 0,
      expectancyR: 0,
      profitFactor: 0,
      totalReturn: 0,
      totalReturnPct: 0,
      cagr: 0,
      maxDD: 0,
      maxDDPct: 0,
      maxDDDays: 0,
      avgBarsHeld: 0,
      bestTrade: null,
      worstTrade: null,
    };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const sumWins = wins.reduce((s, t) => s + t.pnl, 0);
  const sumLosses = losses.reduce((s, t) => s + t.pnl, 0);

  const winRate = wins.length / n;
  const avgWin = wins.length ? sumWins / wins.length : 0;
  const avgLoss = losses.length ? sumLosses / losses.length : 0;
  const expectancy = trades.reduce((s, t) => s + t.pnl, 0) / n;
  const expectancyR = trades.reduce((s, t) => s + (t.rMultiple || 0), 0) / n;
  const profitFactor = sumLosses < 0 ? sumWins / Math.abs(sumLosses) : Infinity;

  const finalEq = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : startEquity;
  const totalReturn = finalEq - startEquity;
  const totalReturnPct = (totalReturn / startEquity) * 100;

  let years = 0;
  if (equityCurve.length >= 2) {
    const secs = equityCurve[equityCurve.length - 1].time - equityCurve[0].time;
    years = secs / (365.25 * 24 * 60 * 60);
  }
  const cagr = years > 0 && finalEq > 0
    ? (Math.pow(finalEq / startEquity, 1 / years) - 1) * 100
    : 0;

  let peak = startEquity;
  let peakTime = equityCurve[0]?.time || 0;
  let maxDD = 0;
  let maxDDPct = 0;
  let maxDDDays = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) {
      peak = pt.equity;
      peakTime = pt.time;
    }
    const dd = peak - pt.equity;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (ddPct > maxDDPct) {
      maxDDPct = ddPct;
      maxDD = dd;
      maxDDDays = (pt.time - peakTime) / 86400;
    }
  }

  const avgBarsHeld = trades.reduce((s, t) => s + (t.barsHeld || 0), 0) / n;
  const bestTrade = trades.reduce((b, t) => (t.pnl > (b?.pnl ?? -Infinity) ? t : b), null);
  const worstTrade = trades.reduce((w, t) => (t.pnl < (w?.pnl ?? Infinity) ? t : w), null);

  return {
    numTrades: n,
    winRate,
    avgWin,
    avgLoss,
    expectancy,
    expectancyR,
    profitFactor,
    totalReturn,
    totalReturnPct,
    cagr,
    maxDD,
    maxDDPct,
    maxDDDays,
    avgBarsHeld,
    bestTrade,
    worstTrade,
  };
}

/**
 * Simple daily returns from a mark-to-market equity curve [{ time, equity }]
 * (one point per day, as backtestPortfolio produces).
 */
export function dailyReturns(equityCurve) {
  const out = [];
  for (let i = 1; i < (equityCurve?.length || 0); i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) out.push(equityCurve[i].equity / prev - 1);
  }
  return out;
}

/**
 * Risk-adjusted stats from a daily mark-to-market equity curve [{ time, equity }]:
 * annualised Sharpe (mean / sample sd of daily returns × √365, zero risk-free
 * rate — crypto trades every day) and annualised volatility, plus total return,
 * CAGR and max drawdown, so systems and benchmarks are scored identically.
 *
 * @returns {{ days, totalReturnPct, cagr, maxDDPct, annVolPct, sharpe }}
 *   sharpe / annVolPct are null with fewer than 2 returns or zero variance.
 */
export function equityCurveStats(equityCurve, startEquity = equityCurve?.[0]?.equity) {
  const curve = equityCurve || [];
  const rets = dailyReturns(curve);
  const n = rets.length;
  const mean = n ? rets.reduce((s, x) => s + x, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;

  const finalEq = curve.length ? curve[curve.length - 1].equity : startEquity;
  const years = curve.length >= 2 ? (curve[curve.length - 1].time - curve[0].time) / (365.25 * 86400) : 0;
  let peak = startEquity, maxDDPct = 0;
  for (const pt of curve) {
    if (pt.equity > peak) peak = pt.equity;
    if (peak > 0) maxDDPct = Math.max(maxDDPct, ((peak - pt.equity) / peak) * 100);
  }
  return {
    days: curve.length,
    totalReturnPct: startEquity > 0 ? (finalEq / startEquity - 1) * 100 : 0,
    cagr: years > 0 && finalEq > 0 && startEquity > 0 ? (Math.pow(finalEq / startEquity, 1 / years) - 1) * 100 : 0,
    maxDDPct,
    annVolPct: sd > 0 ? sd * Math.sqrt(365) * 100 : null,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(365) : null,
  };
}
