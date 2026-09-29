import { atr } from "../indicators/atr.js";
import { donchianCloses } from "../indicators/donchian.js";
import { BOOK } from "./config.js";

/**
 * The Scout's paper test book. Each pick gets a fixed test amount, a stop the
 * moment it's opened, and a trailing exit — the same exit logic as v2.0, so
 * the only thing being tested is the Scout's choice of coin.
 *
 * Fills:
 *   entry  = open of the day after the pick's scan, plus slippage
 *   stop   = intraday low touches the stop → fill at the stop, or at the open
 *            if the day gapped below it; minus slippage
 *   trail  = after each closed day the stop rises to the 10-day close-low
 *            (never lowered)
 *
 * Every position also records BTC's price at entry, so each trade is scored
 * against simply holding BTC over the same days.
 */

const DAY = 86400;
const round = (x, d = 8) => Math.round(x * 10 ** d) / 10 ** d;

export function newBook(cfg = BOOK, nowIso = new Date().toISOString()) {
  return { createdAt: nowIso, startCash: cfg.startCash, cash: cfg.startCash, open: [], closed: [], lastPickDay: null, picksToday: 0 };
}

/** Initial stop from closed daily bars up to (and including) the signal day. */
export function initialStop(closedDaily, entryPrice, cfg = BOOK) {
  const i = closedDaily.length - 1;
  const a = atr(closedDaily, 14)[i];
  const low10 = donchianCloses(closedDaily.map((c) => c.close), cfg.trailPeriod).lower[i];
  const atrStop = a ? entryPrice - cfg.atrMult * a : null;
  const candidates = [atrStop, low10].filter((x) => x !== null && x < entryPrice);
  if (!candidates.length) return entryPrice * 0.85; // fallback: 15% below entry
  return Math.max(...candidates); // the closer of the two
}

/** Why a new position can't be opened today (empty = allowed). */
export function openBlockers(book, coinId, todayKey, nowSec, cfg = BOOK) {
  const r = [];
  if (book.open.length >= cfg.maxOpen) r.push(`already ${cfg.maxOpen} open test positions`);
  const picksToday = book.lastPickDay === todayKey ? book.picksToday : 0;
  if (picksToday >= cfg.maxNewPerDay) r.push("already picked today");
  if (book.cash < cfg.testAmount * (1 + cfg.feePct / 100)) r.push("not enough test cash");
  if (book.open.some((p) => p.id === coinId)) r.push("already holding");
  const last = [...book.closed].reverse().find((p) => p.id === coinId);
  if (last && nowSec - last.exitTime < cfg.cooldownDays * DAY) r.push(`cooldown after exit (${cfg.cooldownDays}d)`);
  return r;
}

/**
 * Opens a position. `formingOpen` is today's opening price (the first print
 * after the scan's closed bars); `closedDaily` are the coin's closed bars.
 */
export function openPosition(book, { coin, closedDaily, formingOpen, formingTime, btcPrice, todayKey, reason, scores }, cfg = BOOK) {
  const entry = formingOpen * (1 + cfg.slippagePct / 100);
  const qty = cfg.testAmount / entry;
  const fee = cfg.testAmount * (cfg.feePct / 100);
  const stop = initialStop(closedDaily, entry, cfg);
  const pos = {
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    entryTime: formingTime,
    entryDay: todayKey,
    entry: round(entry),
    qty: round(qty, 10),
    notional: cfg.testAmount,
    initialStop: round(stop),
    stop: round(stop),
    fees: round(fee, 4),
    btcEntry: btcPrice,
    lastBarTime: formingTime - DAY, // no bar at or after entry processed yet
    reason,
    scoresAtEntry: scores || null,
  };
  book.cash = round(book.cash - cfg.testAmount - fee, 4);
  book.open.push(pos);
  book.picksToday = book.lastPickDay === todayKey ? book.picksToday + 1 : 1;
  book.lastPickDay = todayKey;
  return pos;
}

/**
 * Walks every closed daily bar after the last processed one: first checks the
 * stop against the bar's low, then trails the stop on the close. Idempotent —
 * running it twice on the same bars changes nothing.
 * Returns { exited, stopRaised } for notifications.
 */
export function updatePosition(pos, closedDaily, cfg = BOOK) {
  const closes = closedDaily.map((c) => c.close);
  const low10 = donchianCloses(closes, cfg.trailPeriod).lower;
  let stopRaised = false;
  for (let i = 0; i < closedDaily.length; i++) {
    const bar = closedDaily[i];
    if (bar.time <= pos.lastBarTime || bar.time < pos.entryTime) continue;
    if (bar.low <= pos.stop) {
      const raw = bar.open < pos.stop ? bar.open : pos.stop;
      pos.exit = round(raw * (1 - cfg.slippagePct / 100));
      pos.exitTime = bar.time;
      pos.exitReason = raw === pos.stop ? "stop hit" : "gapped through stop";
      pos.lastBarTime = bar.time;
      return { exited: true, stopRaised };
    }
    const trail = low10[i];
    if (trail !== null && trail > pos.stop) {
      pos.stop = round(trail);
      stopRaised = true;
    }
    pos.lastBarTime = bar.time;
    pos.lastClose = bar.close;
  }
  return { exited: false, stopRaised };
}

/** Moves an exited position to `closed` and books the P&L. */
export function closePosition(book, pos, btcPriceAtExit, cfg = BOOK) {
  const gross = pos.qty * pos.exit;
  const exitFee = gross * (cfg.feePct / 100);
  const pnl = gross - exitFee - pos.notional - pos.fees;
  const riskUsd = pos.qty * (pos.entry - pos.initialStop);
  const closed = {
    ...pos,
    fees: round(pos.fees + exitFee, 4),
    pnl: round(pnl, 2),
    retPct: round((pnl / pos.notional) * 100, 2),
    r: riskUsd > 0 ? round(pnl / riskUsd, 2) : null,
    btcRetPct: pos.btcEntry && btcPriceAtExit ? round((btcPriceAtExit / pos.btcEntry - 1) * 100, 2) : null,
  };
  closed.vsBtcPct = closed.btcRetPct !== null ? round(closed.retPct - closed.btcRetPct, 2) : null;
  book.cash = round(book.cash + gross - exitFee, 4);
  book.open = book.open.filter((p) => p !== pos);
  book.closed.push(closed);
  return closed;
}

/** Mark-to-market summary of the whole book. `prices` maps coin id → last price. */
export function bookSummary(book, prices, btcPrice) {
  const open = book.open.map((p) => {
    const px = prices[p.id] ?? p.lastClose ?? p.entry;
    const value = p.qty * px;
    const retPct = (value / p.notional - 1) * 100;
    const btcRetPct = p.btcEntry && btcPrice ? (btcPrice / p.btcEntry - 1) * 100 : null;
    return { ...p, price: px, value: round(value, 2), retPct: round(retPct, 2), btcRetPct: btcRetPct === null ? null : round(btcRetPct, 2), vsBtcPct: btcRetPct === null ? null : round(retPct - btcRetPct, 2) };
  });
  const equity = book.cash + open.reduce((s, p) => s + p.value, 0);
  const wins = book.closed.filter((t) => t.pnl > 0).length;
  const beatBtc = book.closed.filter((t) => t.vsBtcPct !== null && t.vsBtcPct > 0).length;
  const rs = book.closed.map((t) => t.r).filter((r) => r !== null);
  return {
    cash: round(book.cash, 2),
    equity: round(equity, 2),
    returnPct: round((equity / book.startCash - 1) * 100, 2),
    open,
    closed: book.closed,
    stats: {
      trades: book.closed.length,
      winRate: book.closed.length ? round((wins / book.closed.length) * 100, 1) : null,
      beatBtcRate: book.closed.length ? round((beatBtc / book.closed.length) * 100, 1) : null,
      avgR: rs.length ? round(rs.reduce((s, r) => s + r, 0) / rs.length, 2) : null,
      totalPnl: round(book.closed.reduce((s, t) => s + t.pnl, 0), 2),
    },
  };
}
