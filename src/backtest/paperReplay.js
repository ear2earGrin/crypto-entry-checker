import { fetchKlinesRange, fetchFundingHistory, dropUnclosedCandle } from "../data/binance.js";
import { backtestPortfolio } from "./portfolio.js";
import { PAPER_EPOCH, productionEngineOptions } from "../strategy/presets.js";

/**
 * The paper track as a reusable replay: PRESET_V2 through the portfolio engine
 * on public Binance data from PAPER_EPOCH, exactly as scripts/papertrade.mjs
 * runs it on the Mac. Because the engine applies every portfolio rule (max
 * positions, one entry a day, coin-group caps, cooldown), its state IS the
 * system's instruction set: the Paper tab and the Scanner both read it, so what
 * you are told to do matches what was validated.
 */

export const PAPER_UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
// Must match scripts/papertrade.mjs CFG so browser and robot agree exactly.
export const PAPER_CFG = { equity: 100000, riskPct: 1, warmupDays: 45 };
const DAY = 86400;

export function paperEpochSec(epoch = PAPER_EPOCH) {
  return Math.floor(Date.UTC(Number(epoch.slice(0, 4)), Number(epoch.slice(5, 7)) - 1, Number(epoch.slice(8, 10))) / 1000);
}

/**
 * Daily bars with today's forming candle turned into a synthetic open-only bar
 * (high = low = close = open): yesterday's signals fill at today's real open,
 * but no stop can trigger on an unfinished day. Same convention as the robot.
 */
export function withOpenOnlyFormingBar(dailyRaw, closed) {
  const forming = dailyRaw.length > closed.length ? dailyRaw[dailyRaw.length - 1] : null;
  if (!forming) return closed;
  return [...closed, {
    time: forming.time, closeTime: forming.closeTime,
    open: forming.open, high: forming.open, low: forming.open, close: forming.open,
    volume: 0, takerBuyBase: 0,
  }];
}

async function loadAssetData(asset, epochSec, deps) {
  const epochMs = epochSec * 1000;
  const dailyStart = epochMs - PAPER_CFG.warmupDays * DAY * 1000;
  const weeklyStart = epochMs - 55 * 7 * DAY * 1000;
  const [weeklyRaw, dailyRaw] = await Promise.all([
    deps.fetchKlinesRange({ asset, timeframe: "1W", startTime: weeklyStart }),
    deps.fetchKlinesRange({ asset, timeframe: "1D", startTime: dailyStart }),
  ]);
  const weekly = deps.dropUnclosedCandle(weeklyRaw);
  const closed = deps.dropUnclosedCandle(dailyRaw);
  const daily = withOpenOnlyFormingBar(dailyRaw, closed);
  let funding = null;
  try { funding = await deps.fetchFundingHistory({ asset, startTime: dailyStart }); } catch { /* best-effort */ }
  // Latest traded price (the forming candle's close), for display only.
  const lastRaw = dailyRaw[dailyRaw.length - 1];
  const mark = lastRaw && Number.isFinite(lastRaw.close) ? lastRaw.close : null;
  return { daily, weekly, funding, mark, todayTime: daily.length ? daily[daily.length - 1].time : null };
}

/**
 * Fetch and replay the paper track. Returns the raw engine result plus what the
 * pages need: per-asset marks, the epoch, the current day's bar time and any
 * assets whose data failed to load.
 */
export async function replayPaper({ deps = { fetchKlinesRange, fetchFundingHistory, dropUnclosedCandle } } = {}) {
  const epochSec = paperEpochSec();
  const settled = await Promise.allSettled(PAPER_UNIVERSE.map((a) => loadAssetData(a, epochSec, deps)));
  const dailyByAsset = {}, weeklyByAsset = {}, fundingByAsset = {}, markByAsset = {};
  const failed = [];
  let todayTime = null;
  settled.forEach((r, i) => {
    const a = PAPER_UNIVERSE[i];
    if (r.status !== "fulfilled") { failed.push(a); return; }
    dailyByAsset[a] = r.value.daily;
    weeklyByAsset[a] = r.value.weekly;
    fundingByAsset[a] = r.value.funding;
    markByAsset[a] = r.value.mark;
    if (r.value.todayTime && (!todayTime || r.value.todayTime > todayTime)) todayTime = r.value.todayTime;
  });
  if (Object.keys(dailyByAsset).length === 0) throw new Error("No asset data loaded — check network.");

  const res = backtestPortfolio({
    dailyByAsset, weeklyByAsset, fundingByAsset,
    startEquity: PAPER_CFG.equity, riskPct: PAPER_CFG.riskPct,
    ...productionEngineOptions(),
  });
  return { res, epochSec, markByAsset, todayTime, failed, fundingMissing: PAPER_UNIVERSE.filter((a) => dailyByAsset[a] && !fundingByAsset[a]?.length) };
}

/**
 * What to do today, read off the engine's state. Pure, so it is unit-tested.
 *   buys:     positions the engine opened at today's open (yesterday's signal)
 *   stops:    every open position with the stop level to have resting on the exchange
 *   stoppedOut: trades that closed on yesterday's bar (a resting stop already filled)
 * Only positions/trades entered on or after the paper epoch count.
 */
export function todaysOrders({ res, epochSec, todayTime }) {
  const open = res.openPositions.filter((p) => p.entryTime >= epochSec);
  const yesterday = todayTime - DAY;
  return {
    buys: open.filter((p) => p.entryTime === todayTime),
    stops: open.map((p) => ({ asset: p.asset, stop: p.stop, initialStop: p.initialStop, entry: p.entry, entryTime: p.entryTime, qty: p.qty, riskAmount: p.riskAmount, isNew: p.entryTime === todayTime })),
    stoppedOut: res.trades.filter((t) => t.exitReason !== "end of data" && t.entryTime >= epochSec && t.exitTime === yesterday),
  };
}

/**
 * Scale a paper position (sized at 1% of the paper account) to your own account
 * and risk %. The stop distance is identical, so quantity scales with the dollar
 * risk: yourQty = paperQty × yourRisk$ / paperRisk$.
 */
export function scaleToAccount({ qty, riskAmount }, { equity, riskPct }) {
  if (!(riskAmount > 0) || !(equity > 0) || !(riskPct > 0)) return null;
  return qty * (equity * riskPct / 100) / riskAmount;
}
