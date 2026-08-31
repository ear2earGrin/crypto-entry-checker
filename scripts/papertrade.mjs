#!/usr/bin/env node
/**
 * Paper-trading daemon — the automatic version of the daily routine.
 *
 * Design: every run replays the ENTIRE paper period through the exact same
 * validated portfolio engine (PRESET_V2) the backtest used, then diffs the
 * result against what was already announced. Consequences:
 *   - Missed days are impossible: if the Mac was off for a week, the replay
 *     fills every entry at the correct historical next-day open, identical to
 *     how the backtest would have.
 *   - Zero drift: the paper track IS the engine, not a reimplementation.
 *   - Idempotent: safe to run hourly; only NEW events notify.
 *
 * Today's forming candle is included as a synthetic bar carrying ONLY its open
 * (high=low=close=open), so yesterday's signals fill at today's real open
 * (live behavior) without evaluating stops against an unfinished bar.
 *
 * State: data/paper/state.json (announced-event keys, epoch).
 * Log:   data/paper/paper-log.md (append-only event journal)
 * Status: data/paper/status.md (current portfolio snapshot, overwritten)
 * Notifications: macOS notification center (best-effort, skipped elsewhere).
 *
 * Usage:
 *   node scripts/papertrade.mjs             # one run (launchd runs this hourly)
 *   node scripts/papertrade.mjs --selftest  # synthetic data, no network
 */

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { backtestPortfolio } from "../src/backtest/portfolio.js";
import { PRESET_V2 } from "../src/strategy/presets.js";
import { computeRegime } from "../src/strategy/regime.js";
import {
  UNIVERSE, fetchKlinesRange, dropUnclosed, loadFunding, synth, synthFunding, f,
} from "./lib/data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIR = join(ROOT, "data", "paper");

const CFG = {
  equity: 100000,
  riskPct: 1,       // paper at 1%; live starts at 0.75% per spec v2.0
  feePct: 0.08,
  slippagePct: 0.05,
  warmupDays: 45,   // indicator warmup fetched before the epoch
};

const SELFTEST = process.argv.includes("--selftest");
const STATE_PATH = join(DIR, SELFTEST ? "selftest-state.json" : "state.json");
const LOG_PATH = join(DIR, SELFTEST ? "selftest-log.md" : "paper-log.md");
const STATUS_PATH = join(DIR, SELFTEST ? "selftest-status.md" : "status.md");

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); } catch { return null; }
}
function saveState(s) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
function logLine(line) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(LOG_PATH, line + "\n");
  console.log(line);
}
function notifyMac(title, body) {
  if (SELFTEST) return;
  try {
    const esc = (x) => String(x).replace(/"/g, "'");
    execFile("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`], () => {});
  } catch { /* not macOS — log only */ }
}

// Phone push via ntfy.sh: if data/paper/ntfy.txt contains a topic name, every
// event is POSTed there. Install the ntfy app on your phone and subscribe to
// the same topic (treat the topic name as a secret — it IS the auth).
function ntfyTopic() {
  try { return readFileSync(join(DIR, "ntfy.txt"), "utf8").trim() || null; } catch { return null; }
}
async function notifyPhone(title, body) {
  if (SELFTEST) return;
  const topic = ntfyTopic();
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { Title: title.replace(/[^\x20-\x7E]/g, ""), Priority: "high" },
      body,
    });
  } catch { /* best-effort */ }
}
const ymd = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);

async function loadData(epochMs) {
  const weeklyStart = epochMs - 55 * 7 * 86400 * 1000;
  const dailyStart = epochMs - CFG.warmupDays * 86400 * 1000;
  const dailyByAsset = {}, weeklyByAsset = {}, fundingByAsset = {};
  for (const asset of UNIVERSE) {
    const symbol = `${asset}USDT`;
    const [weeklyRaw, dailyRaw] = await Promise.all([
      fetchKlinesRange(symbol, "1w", weeklyStart),
      fetchKlinesRange(symbol, "1d", dailyStart),
    ]);
    const weekly = dropUnclosed(weeklyRaw);
    const closed = dropUnclosed(dailyRaw);
    // Forming bar → synthetic open-only bar so pending entries fill at today's
    // real open, but no stop can trigger on an unfinished day.
    const forming = dailyRaw.length > closed.length ? dailyRaw[dailyRaw.length - 1] : null;
    const daily = forming
      ? [...closed, {
          time: forming.time, closeTime: forming.closeTime,
          open: forming.open, high: forming.open, low: forming.open, close: forming.open,
          volume: 0, takerBuyBase: 0,
        }]
      : closed;
    dailyByAsset[asset] = daily;
    weeklyByAsset[asset] = weekly;
    try {
      fundingByAsset[asset] = await loadFunding(asset, new Date(dailyStart).getUTCFullYear());
    } catch { fundingByAsset[asset] = null; }
  }
  return { dailyByAsset, weeklyByAsset, fundingByAsset };
}

function loadSelftestData() {
  const dailyByAsset = {}, weeklyByAsset = {}, fundingByAsset = {};
  UNIVERSE.forEach((asset, i) => {
    const { weekly, daily } = synth(asset, i * 1.7, 700);
    dailyByAsset[asset] = daily;
    weeklyByAsset[asset] = weekly;
    fundingByAsset[asset] = synthFunding(700);
  });
  return { dailyByAsset, weeklyByAsset, fundingByAsset };
}

async function main() {
  const nowIso = new Date().toISOString();
  let state = loadState();
  if (!state) {
    state = {
      paperEpoch: SELFTEST ? "2020-02-15" : new Date().toISOString().slice(0, 10),
      announced: {},
      stops: {},
      createdAt: nowIso,
    };
    logLine(`\n## Paper trading initialized ${nowIso} — epoch ${state.paperEpoch}, equity ${f(CFG.equity, 0)}, risk ${CFG.riskPct}%\n`);
  }
  const epochMs = Date.UTC(
    Number(state.paperEpoch.slice(0, 4)),
    Number(state.paperEpoch.slice(5, 7)) - 1,
    Number(state.paperEpoch.slice(8, 10)),
  );
  const epochSec = Math.floor(epochMs / 1000);

  const data = SELFTEST ? loadSelftestData() : await loadData(epochMs);

  // Regime-flip announcements: the flip PRECEDES the first entry, and the owner's
  // discretionary plans are keyed to it — so it deserves its own notification.
  if (!state.regimes) state.regimes = {};
  const regimeEvents = [];
  for (const asset of Object.keys(data.weeklyByAsset)) {
    const latest = computeRegime(data.weeklyByAsset[asset], PRESET_V2.regimeParams).latest;
    if (!latest) continue;
    const now = latest.state;
    const prev = state.regimes[asset];
    if (prev && prev !== now) {
      if (now === "LONG_OK") {
        regimeEvents.push(`🟢 REGIME FLIP ${asset}: BULL — longs allowed (weekly close ${f(latest.close, 2)} > 50W ${f(latest.sma, 2)}). First breakout close will trigger an entry.`);
      } else {
        regimeEvents.push(`🔴 REGIME ${asset}: back to ${now === "SHORT_OK" ? "BEAR — stand aside" : now}.`);
      }
    }
    state.regimes[asset] = now;
  }

  const res = backtestPortfolio({
    ...data,
    startEquity: CFG.equity,
    riskPct: CFG.riskPct,
    feePct: CFG.feePct,
    slippagePct: CFG.slippagePct,
    signalParams: PRESET_V2.signalParams,
    regimeParams: PRESET_V2.regimeParams,
    exitOnRegimeFlip: PRESET_V2.exitOnRegimeFlip,
  });

  const realized = res.trades.filter((t) => t.exitReason !== "end of data");
  const events = [];

  // Entries: open positions + realized trades that started after the epoch.
  const entered = [
    ...res.openPositions.map((p) => ({ ...p, _open: true })),
    ...realized.map((t) => ({ ...t, _open: false })),
  ].filter((t) => t.entryTime >= epochSec);

  for (const t of entered) {
    const ek = `E|${t.asset}|${t.entryTime}`;
    if (!state.announced[ek]) {
      state.announced[ek] = true;
      events.push(`📈 PAPER ENTRY ${t.asset}: LONG ${f(t.qty, 6)} @ ${f(t.entry, 4)} (${ymd(t.entryTime)}), stop ${f(t.initialStop, 4)}, risk ${f(t.riskAmount, 0)} USDT`);
    }
  }
  for (const t of realized.filter((t) => t.entryTime >= epochSec)) {
    const xk = `X|${t.asset}|${t.entryTime}|${t.exitTime}`;
    if (!state.announced[xk]) {
      state.announced[xk] = true;
      const emo = t.pnl >= 0 ? "✅" : "🔻";
      events.push(`${emo} PAPER EXIT ${t.asset}: ${f(t.qty, 6)} @ ${f(t.exit, 4)} (${ymd(t.exitTime)}) — ${t.exitReason}. PnL ${f(t.pnl, 0)} USDT (${f(t.rMultiple, 2)}R)`);
    }
  }
  // Trailing-stop raises on open positions.
  for (const p of res.openPositions.filter((p) => p.entryTime >= epochSec)) {
    const sk = `${p.asset}|${p.entryTime}`;
    const prev = state.stops[sk];
    if (prev !== undefined && p.stop > prev) {
      events.push(`🔒 STOP RAISED ${p.asset}: ${f(prev, 4)} → ${f(p.stop, 4)}. Update your (paper) stop.`);
    }
    state.stops[sk] = p.stop;
  }

  // Announce (regime flips first — they're the headline).
  const allEvents = [...regimeEvents, ...events];
  for (const e of allEvents) {
    logLine(`- ${nowIso} ${e}`);
    notifyMac("Crypto System", e.replace(/^[^\s]+\s/, ""));
    await notifyPhone("Crypto System", e);
  }

  // Status snapshot (overwritten each run).
  const paperTrades = realized.filter((t) => t.entryTime >= epochSec);
  const pnlSum = paperTrades.reduce((s, t) => s + t.pnl, 0);
  const wins = paperTrades.filter((t) => t.pnl > 0).length;
  const openLines = res.openPositions.filter((p) => p.entryTime >= epochSec).map((p) =>
    `| ${p.asset} | ${ymd(p.entryTime)} | ${f(p.entry, 4)} | ${f(p.stop, 4)} | ${f(p.qty, 6)} |`);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(STATUS_PATH, [
    `# Paper trading status — updated ${nowIso}`,
    "",
    `- Epoch: ${state.paperEpoch} | Strategy: v2.0 | Risk ${CFG.riskPct}% of ${f(CFG.equity, 0)} USDT`,
    `- Closed paper trades: ${paperTrades.length} (${wins} wins) | Realized PnL: ${f(pnlSum, 0)} USDT`,
    "",
    "## Open paper positions",
    "",
    openLines.length ? "| Asset | Since | Entry | Current stop | Qty |" : "_none — system is in cash_",
    openLines.length ? "|---|---|---|---|---|" : "",
    ...openLines,
    "",
    `_${allEvents.length ? allEvents.length + " new event(s) this run." : "No new events this run."}_`,
  ].filter((l) => l !== "").join("\n") + "\n");

  state.lastRunAt = nowIso;
  saveState(state);

  console.log(`\n[paper] run complete ${nowIso}: ${allEvents.length} new event(s), ` +
    `${res.openPositions.filter((p) => p.entryTime >= epochSec).length} open, ` +
    `${paperTrades.length} closed since epoch. Status: ${STATUS_PATH}`);
}

main().catch((e) => {
  logLine(`- ${new Date().toISOString()} ⚠️ paper run FAILED: ${e.message}`);
  console.error(e);
  process.exit(1);
});
