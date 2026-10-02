import { useState } from "react";
import { fetchKlinesRange, fetchFundingHistory, dropUnclosedCandle } from "../data/binance.js";
import { backtestPortfolio } from "../backtest/portfolio.js";
import { markOpenPosition } from "../backtest/markToMarket.js";
import { PRODUCTION_PRESET, PAPER_EPOCH } from "../strategy/presets.js";
import { T, ui, signColor } from "../ui/theme.js";
import { Page, PageHeader, Tile } from "../ui/Page.jsx";

/**
 * PAPER — the browser mirror of the Mac mini's paper-trading robot.
 *
 * The robot's design makes this possible with no backend: the paper track is a
 * deterministic replay of PRESET_V2 over public Binance data from PAPER_EPOCH.
 * This page runs the SAME engine with the SAME config in the browser, so it
 * always shows the current truth — on localhost or on pm-brief.com — and flags
 * every event that appeared since your last visit (tracked in localStorage).
 */

const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
// Must match scripts/papertrade.mjs CFG so browser and robot agree exactly.
const CFG = { equity: 100000, riskPct: 1, feePct: 0.08, slippagePct: 0.05, warmupDays: 45 };
const SEEN_KEY = "paperSeen.v1";

function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}
const ymd = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : "-");

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); }
}
function saveSeen(keys) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...keys])); } catch { /* empty */ }
}

async function loadAssetData(asset, epochMs) {
  const dailyStart = epochMs - CFG.warmupDays * 86400 * 1000;
  const weeklyStart = epochMs - 55 * 7 * 86400 * 1000;
  const [weeklyRaw, dailyRaw] = await Promise.all([
    fetchKlinesRange({ asset, timeframe: "1W", startTime: weeklyStart }),
    fetchKlinesRange({ asset, timeframe: "1D", startTime: dailyStart }),
  ]);
  const weekly = dropUnclosedCandle(weeklyRaw);
  const closed = dropUnclosedCandle(dailyRaw);
  // Forming bar becomes a synthetic open-only bar (high=low=close=open):
  // yesterday's signals fill at today's real open, but no stop can trigger on
  // an unfinished day. Identical convention to the Mac robot.
  const forming = dailyRaw.length > closed.length ? dailyRaw[dailyRaw.length - 1] : null;
  const daily = forming
    ? [...closed, {
        time: forming.time, closeTime: forming.closeTime,
        open: forming.open, high: forming.open, low: forming.open, close: forming.open,
        volume: 0, takerBuyBase: 0,
      }]
    : closed;
  let funding = null;
  try { funding = await fetchFundingHistory({ asset, startTime: dailyStart }); } catch { /* best-effort */ }
  // Mark price for open positions: the forming candle's close is Binance's
  // latest trade. Display only — the engine above never sees it.
  const lastRaw = dailyRaw[dailyRaw.length - 1];
  const mark = lastRaw && Number.isFinite(lastRaw.close) ? lastRaw.close : null;
  return { daily, weekly, funding, mark };
}

export default function PaperTrack() {
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [result, setResult] = useState(null);

  async function check() {
    setStatus({ state: "loading", message: `Replaying paper track since ${PAPER_EPOCH}...` });
    try {
      const epochMs = Date.UTC(
        Number(PAPER_EPOCH.slice(0, 4)), Number(PAPER_EPOCH.slice(5, 7)) - 1, Number(PAPER_EPOCH.slice(8, 10)),
      );
      const epochSec = Math.floor(epochMs / 1000);

      const settled = await Promise.allSettled(UNIVERSE.map((a) => loadAssetData(a, epochMs)));
      const dailyByAsset = {}, weeklyByAsset = {}, fundingByAsset = {}, markByAsset = {};
      const failed = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") {
          dailyByAsset[UNIVERSE[i]] = r.value.daily;
          weeklyByAsset[UNIVERSE[i]] = r.value.weekly;
          fundingByAsset[UNIVERSE[i]] = r.value.funding;
          markByAsset[UNIVERSE[i]] = r.value.mark;
        } else failed.push(UNIVERSE[i]);
      });
      if (Object.keys(dailyByAsset).length === 0) throw new Error("No asset data loaded — check network.");

      const res = backtestPortfolio({
        dailyByAsset, weeklyByAsset, fundingByAsset,
        startEquity: CFG.equity, riskPct: CFG.riskPct,
        feePct: CFG.feePct, slippagePct: CFG.slippagePct,
        signalParams: PRODUCTION_PRESET.signalParams,
        regimeParams: PRODUCTION_PRESET.regimeParams,
        exitOnRegimeFlip: PRODUCTION_PRESET.exitOnRegimeFlip,
      });

      const realized = res.trades.filter((t) => t.exitReason !== "end of data" && t.entryTime >= epochSec);
      // Unrealized PnL: what each open position would net if closed at the
      // latest price (after slippage, fees and funding, as the engine settles
      // trades), and what it nets if its current trailing stop is hit.
      const costs = { feePct: CFG.feePct, slippagePct: CFG.slippagePct };
      const open = res.openPositions
        .filter((p) => p.entryTime >= epochSec)
        .map((p) => ({
          ...p,
          now: markOpenPosition({ pos: p, price: markByAsset[p.asset], ...costs }),
          atStop: markOpenPosition({ pos: p, price: p.stop, ...costs }),
        }));
      const unrealized = open.reduce((s, p) => s + (p.now ? p.now.net : 0), 0);
      const unmarked = open.filter((p) => !p.now).map((p) => p.asset);

      const events = [];
      const riskOf = (t) => t.qty * Math.abs(t.entry - t.initialStop);
      for (const t of realized) {
        events.push({
          key: `E|${t.asset}|${t.entryTime}`, time: t.entryTime, kind: "ENTRY",
          text: `LONG ${fmt(t.qty, 6)} ${t.asset} @ ${fmt(t.entry, 4)} — stop ${fmt(t.initialStop, 4)}, risk ${fmt(riskOf(t), 0)} USDT`,
        });
        events.push({
          key: `X|${t.asset}|${t.entryTime}|${t.exitTime}`, time: t.exitTime, kind: t.pnl >= 0 ? "WIN" : "LOSS",
          text: `EXIT ${t.asset} @ ${fmt(t.exit, 4)} (${t.exitReason}) — PnL ${fmt(t.pnl, 0)} USDT (${fmt(t.rMultiple, 2)}R)`,
        });
      }
      for (const p of open) {
        events.push({
          key: `E|${p.asset}|${p.entryTime}`, time: p.entryTime, kind: "OPEN",
          text: `LONG ${fmt(p.qty, 6)} ${p.asset} @ ${fmt(p.entry, 4)} — OPEN, current stop ${fmt(p.stop, 4)}`,
        });
      }
      events.sort((a, b) => b.time - a.time);

      const seen = loadSeen();
      const fresh = events.filter((e) => !seen.has(e.key));
      saveSeen(new Set([...seen, ...events.map((e) => e.key)]));

      const pnl = realized.reduce((s, t) => s + t.pnl, 0);
      const wins = realized.filter((t) => t.pnl > 0).length;

      setResult({
        events, freshKeys: new Set(fresh.map((e) => e.key)), open, realized, pnl, wins, failed,
        unrealized, unmarked, markedAt: new Date(),
      });
      setStatus({
        state: "ok",
        message: fresh.length
          ? `${fresh.length} NEW event(s) since your last visit.`
          : "No new events since your last visit.",
      });
    } catch (e) {
      setStatus({ state: "error", message: e?.message || "Paper replay failed." });
    }
  }

  const kindColor = { ENTRY: T.info, OPEN: T.up, WIN: T.up, LOSS: T.down };

  return (
    <Page>
      <PageHeader
        eyebrow="Paper trading · Crypto System v2.0"
        title="Paper track"
        actions={
          <button style={ui.btnPrimary} onClick={check} type="button" disabled={status.state === "loading"}>
            {status.state === "loading" ? "Replaying…" : "Check paper track"}
          </button>
        }
      >
        <p className="muted">
          Live mirror of the paper-trading robot — same v2.0 engine, same config,
          recomputed in your browser from public data since {PAPER_EPOCH}. Works
          anywhere this page is hosted; flags what changed since your last visit.
        </p>
      </PageHeader>

      {status.message ? (
        <div style={
          status.state === "error" ? ui.bannerBad
            : result?.freshKeys?.size ? ui.bannerGood
            : { ...ui.banner, borderColor: T.line, background: T.panel }
        }>
          {status.state === "error" ? "⚠️ " : result?.freshKeys?.size ? "🔔 " : ""}{status.message}
          {result?.failed?.length ? ` (data failed for: ${result.failed.join(", ")})` : ""}
        </div>
      ) : null}

      {result ? (
        <>
          <div style={ui.tiles}>
            <Tile label="Since" value={PAPER_EPOCH} />
            <Tile label="Open positions" value={String(result.open.length)} />
            <Tile label="Closed trades" value={`${result.realized.length} (${result.wins} wins)`} />
            <Tile label="Realized PnL" value={`${fmt(result.pnl, 0)} USDT`} good={result.pnl > 0} bad={result.pnl < 0} />
            <Tile
              label="Unrealized PnL"
              value={`${fmt(result.unrealized, 0)} USDT`}
              sub={result.open.length ? `${result.open.length} open, at live price` : "no open positions"}
              good={result.unrealized > 0} bad={result.unrealized < 0}
            />
            <Tile
              label="Total PnL"
              value={`${fmt(result.pnl + result.unrealized, 0)} USDT`}
              sub={`${fmt(((result.pnl + result.unrealized) / CFG.equity) * 100, 2)}% of ${fmt(CFG.equity, 0)}`}
              good={result.pnl + result.unrealized > 0} bad={result.pnl + result.unrealized < 0}
            />
          </div>

          <h2 style={ui.h2}>Open paper positions</h2>
          {result.open.length === 0 ? (
            <div style={ui.empty}>None — the system is in cash. In a bear regime, that IS the position.</div>
          ) : (
            <div style={ui.tableWrap}>
              <table style={ui.table}>
                <thead><tr>
                  <th style={styles.th}>Asset</th><th style={styles.th}>Since</th><th style={styles.th}>Entry</th>
                  <th style={styles.th}>Now</th><th style={styles.th}>Move</th>
                  <th style={styles.th}>Unrealized PnL</th><th style={styles.th}>R</th>
                  <th style={styles.th}>Current stop</th><th style={styles.th}>At stop</th><th style={styles.th}>Qty</th>
                </tr></thead>
                <tbody>
                  {result.open.map((p) => (
                    <tr key={p.asset + p.entryTime}>
                      <td style={{ ...styles.td, fontFamily: T.body, fontWeight: 600 }}>{p.asset}</td>
                      <td style={styles.td}>{ymd(p.entryTime)}</td>
                      <td style={styles.td}>{fmt(p.entry, 4)}</td>
                      <td style={styles.td}>{p.now ? fmt(p.now.price, 4) : "-"}</td>
                      <td style={{ ...styles.td, color: signColor(p.now?.movePct) }}>{p.now ? `${p.now.movePct >= 0 ? "+" : ""}${fmt(p.now.movePct, 2)}%` : "-"}</td>
                      <td style={{ ...styles.td, color: signColor(p.now?.net), fontWeight: 500 }}>{p.now ? `${fmt(p.now.net, 0)} USDT` : "-"}</td>
                      <td style={{ ...styles.td, color: signColor(p.now?.r) }}>{p.now ? `${fmt(p.now.r, 2)}R` : "-"}</td>
                      <td style={styles.td}>{fmt(p.stop, 4)}</td>
                      <td style={{ ...styles.td, color: signColor(p.atStop?.net) }} title="What the position nets if the current trailing stop is hit">
                        {p.atStop ? `${fmt(p.atStop.net, 0)} USDT` : "-"}
                      </td>
                      <td style={styles.td}>{fmt(p.qty, 6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.open.length ? (
            <p style={ui.foot}>
              Unrealized = what closing at Binance&apos;s latest price ({result.markedAt.toLocaleTimeString()}) would net
              after slippage, fees and funding — the same costs the engine charges on a real exit. At stop = what each
              position nets if its current trailing stop is hit; positive means profit is already locked in.
              {result.unmarked.length ? ` No live price for: ${result.unmarked.join(", ")}.` : ""}
            </p>
          ) : null}

          <div style={styles.journalHead}>
            <h2 style={ui.h2}>Event journal</h2>
            <span style={ui.small}>Newest first</span>
          </div>
          {result.events.length === 0 ? (
            <div style={ui.empty}>No paper trades yet — the first weekly regime flip + breakout will appear here.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {result.events.map((e) => (
                <div key={e.key + e.time} style={{
                  ...styles.event,
                  borderColor: result.freshKeys.has(e.key) ? T.up : T.line,
                  background: result.freshKeys.has(e.key) ? T.upBg : T.panel,
                }}>
                  <span style={{ ...ui.mono, color: T.muted, marginRight: 10 }}>{ymd(e.time)}</span>
                  <span style={{ ...ui.mono, color: kindColor[e.kind] || T.ink, fontWeight: 500, marginRight: 10 }}>{e.kind}</span>
                  {e.text}
                  {result.freshKeys.has(e.key) ? <span style={styles.newTag}>NEW</span> : null}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={ui.empty}>
          Click CHECK PAPER TRACK. This replays the entire paper phase through the
          validated engine — a few seconds of fetching, then the full journal.
        </div>
      )}
    </Page>
  );
}

const styles = {
  journalHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px" },
  th: ui.th,
  td: ui.td,
  event: { padding: "9px 12px", borderRadius: 6, border: "1px solid", fontSize: 13, lineHeight: 1.5 },
  newTag: { ...ui.badge, marginLeft: 10, background: "var(--up-bg)", color: "var(--up)", border: "1px solid var(--up)" },
};
