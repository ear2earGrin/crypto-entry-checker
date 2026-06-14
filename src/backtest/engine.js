import { computeRegime, REGIME_PARAMS } from "../strategy/regime.js";
import { computeSignal, SIGNAL_PARAMS } from "../strategy/signal.js";
import { donchianCloses } from "../indicators/donchian.js";
import { sizePosition } from "../strategy/sizing.js";

// Slippage applied to fills. A buy (long entry, short cover) fills WORSE = higher;
// a sell (long exit, short entry) fills worse = lower. In 24/7 crypto there is no
// overnight gap, so the open/close fill difference is small — slippage and cascade
// fills are the real execution cost, which is what this models.
function slip(price, side, slippagePct) {
  const s = (slippagePct || 0) / 100;
  return side === "buy" ? price * (1 + s) : price * (1 - s);
}

function findLastClosedWeeklyIdx(weekly, t) {
  let lo = 0;
  let hi = weekly.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const close = weekly[mid].closeTime ?? weekly[mid].time;
    if (close <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export function backtestOne({
  asset = "ASSET",
  weekly,
  daily,
  startEquity = 100000,
  riskPct = 1,
  feePct = 0.08,
  slippagePct = 0,
  signalParams = SIGNAL_PARAMS,
  regimeParams = REGIME_PARAMS,
}) {
  const regime = computeRegime(weekly, regimeParams);
  const closes = daily.map((c) => c.close);
  const trail10 = donchianCloses(closes, signalParams.donchianExit);

  let equity = startEquity;
  let pos = null;
  const trades = [];
  const equityCurve = [];
  let dailyRegime = new Array(daily.length).fill("WARMUP");

  for (let i = 0; i < daily.length; i++) {
    const wIdx = findLastClosedWeeklyIdx(weekly, daily[i].time);
    dailyRegime[i] = wIdx >= 0 ? regime.series[wIdx]?.state || "WARMUP" : "WARMUP";
  }

  const signalSeries = computeSignal(daily, dailyRegime, signalParams).series;

  for (let i = 0; i < daily.length; i++) {
    const bar = daily[i];
    const regimeState = dailyRegime[i];

    if (pos) {
      if (i > 0) {
        if (pos.direction === "LONG") {
          const lo = trail10.lower[i - 1];
          if (lo !== null) pos.stop = Math.max(pos.stop, lo);
        } else {
          const hi = trail10.upper[i - 1];
          if (hi !== null) pos.stop = Math.min(pos.stop, hi);
        }
      }

      let exited = false;
      let exitPrice = null;
      let exitReason = null;

      if (pos.direction === "LONG" && bar.low <= pos.stop) {
        // Gap-aware: if the bar opened below the stop, we fill at the (worse) open,
        // not the stop price. Then apply slippage on the sell.
        const raw = bar.open < pos.stop ? bar.open : pos.stop;
        exitPrice = slip(raw, "sell", slippagePct);
        exitReason = "trailing stop hit";
        exited = true;
      } else if (pos.direction === "SHORT" && bar.high >= pos.stop) {
        const raw = bar.open > pos.stop ? bar.open : pos.stop;
        exitPrice = slip(raw, "buy", slippagePct);
        exitReason = "trailing stop hit";
        exited = true;
      }

      if (!exited) {
        const flipLong = pos.direction === "LONG" && regimeState !== "LONG_OK";
        const flipShort = pos.direction === "SHORT" && regimeState !== "SHORT_OK";
        if (flipLong || flipShort) {
          exitPrice = slip(bar.close, pos.direction === "LONG" ? "sell" : "buy", slippagePct);
          exitReason = `regime flipped to ${regimeState}`;
          exited = true;
        }
      }

      if (exited) {
        const dir = pos.direction === "LONG" ? 1 : -1;
        const gross = dir * pos.qty * (exitPrice - pos.entry);
        const fees = (Math.abs(pos.entry) + Math.abs(exitPrice)) * pos.qty * (feePct / 100);
        const net = gross - fees;
        equity += net;
        trades.push({
          asset: pos.asset,
          direction: pos.direction,
          entryTime: pos.entryTime,
          entry: pos.entry,
          initialStop: pos.initialStop,
          exitTime: bar.time,
          exit: exitPrice,
          exitReason,
          qty: pos.qty,
          pnl: net,
          pnlPct: net / startEquity * 100,
          rMultiple: net / pos.riskAmount,
          barsHeld: i - pos.entryIdx,
        });
        pos = null;
      }
    }

    if (!pos) {
      const sig = signalSeries[i];
      if (sig && (sig.action === "LONG" || sig.action === "SHORT")) {
        const entryFill = slip(sig.close, sig.action === "LONG" ? "buy" : "sell", slippagePct);
        const sz = sizePosition({
          equity,
          riskPct,
          entry: entryFill,
          stop: sig.stop,
          direction: sig.action,
        });
        if (sz.ok && Number.isFinite(sz.qty) && sz.qty > 0) {
          pos = {
            asset,
            direction: sig.action,
            entry: entryFill,
            initialStop: sig.stop,
            stop: sig.stop,
            qty: sz.qty,
            riskAmount: sz.riskDollar,
            entryTime: bar.time,
            entryIdx: i,
          };
        }
      }
    }

    let unrealized = 0;
    if (pos) {
      const dir = pos.direction === "LONG" ? 1 : -1;
      unrealized = dir * pos.qty * (bar.close - pos.entry);
    }
    equityCurve.push({ time: bar.time, equity: equity + unrealized, hasPosition: !!pos });
  }

  if (pos) {
    const last = daily[daily.length - 1];
    const dir = pos.direction === "LONG" ? 1 : -1;
    const exitFill = slip(last.close, pos.direction === "LONG" ? "sell" : "buy", slippagePct);
    const gross = dir * pos.qty * (exitFill - pos.entry);
    const fees = (Math.abs(pos.entry) + Math.abs(exitFill)) * pos.qty * (feePct / 100);
    const net = gross - fees;
    equity += net;
    trades.push({
      asset: pos.asset,
      direction: pos.direction,
      entryTime: pos.entryTime,
      entry: pos.entry,
      initialStop: pos.initialStop,
      exitTime: last.time,
      exit: exitFill,
      exitReason: "end of data",
      qty: pos.qty,
      pnl: net,
      pnlPct: net / startEquity * 100,
      rMultiple: net / pos.riskAmount,
      barsHeld: daily.length - 1 - pos.entryIdx,
    });
  }

  return { trades, equityCurve, finalEquity: equity, startEquity };
}
