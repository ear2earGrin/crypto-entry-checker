import { useMemo, useState } from "react";
import { fetchKlinesRange, fetchFundingHistory, dropUnclosedCandle } from "../data/binance.js";
import { backtestPortfolio } from "../backtest/portfolio.js";
import { PRODUCTION_PRESET, PAPER_EPOCH } from "../strategy/presets.js";

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
  return { daily, weekly, funding };
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
      const dailyByAsset = {}, weeklyByAsset = {}, fundingByAsset = {};
      const failed = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") {
          dailyByAsset[UNIVERSE[i]] = r.value.daily;
          weeklyByAsset[UNIVERSE[i]] = r.value.weekly;
          fundingByAsset[UNIVERSE[i]] = r.value.funding;
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
      const open = res.openPositions.filter((p) => p.entryTime >= epochSec);

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

      setResult({ events, freshKeys: new Set(fresh.map((e) => e.key)), open, realized, pnl, wins, failed });
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

  const kindColor = { ENTRY: "#7cd8ff", OPEN: "#7cffb1", WIN: "#7cffb1", LOSS: "#ff7c9c" };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>PAPER TRACK</h1>
          <div style={styles.subtitle}>
            Live mirror of the paper-trading robot — same v2.0 engine, same config,
            recomputed in your browser from public data since {PAPER_EPOCH}. Works
            anywhere this page is hosted; flags what changed since your last visit.
          </div>
        </div>
        <button style={styles.btn} onClick={check} type="button" disabled={status.state === "loading"}>
          {status.state === "loading" ? "REPLAYING..." : "CHECK PAPER TRACK"}
        </button>
      </div>

      {status.message ? (
        <div style={{
          ...styles.banner,
          borderColor: status.state === "error" ? "#ff7c9c55" : result?.freshKeys?.size ? "#7cffb155" : "#2cff9c22",
          color: status.state === "error" ? "#ff7c9c" : "#d7ffe8",
        }}>
          {status.state === "error" ? "⚠️ " : result?.freshKeys?.size ? "🔔 " : ""}{status.message}
          {result?.failed?.length ? ` (data failed for: ${result.failed.join(", ")})` : ""}
        </div>
      ) : null}

      {result ? (
        <>
          <div style={styles.statsRow}>
            <Stat label="Since" value={PAPER_EPOCH} />
            <Stat label="Open positions" value={String(result.open.length)} />
            <Stat label="Closed trades" value={`${result.realized.length} (${result.wins} wins)`} />
            <Stat label="Realized PnL" value={`${fmt(result.pnl, 0)} USDT`} good={result.pnl > 0} bad={result.pnl < 0} />
          </div>

          <div style={styles.sectionTitle}>OPEN PAPER POSITIONS</div>
          {result.open.length === 0 ? (
            <div style={styles.empty}>None — the system is in cash. In a bear regime, that IS the position.</div>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead><tr>
                  <th style={styles.th}>Asset</th><th style={styles.th}>Since</th><th style={styles.th}>Entry</th>
                  <th style={styles.th}>Current stop</th><th style={styles.th}>Qty</th>
                </tr></thead>
                <tbody>
                  {result.open.map((p) => (
                    <tr key={p.asset + p.entryTime}>
                      <td style={{ ...styles.td, fontWeight: 700 }}>{p.asset}</td>
                      <td style={styles.td}>{ymd(p.entryTime)}</td>
                      <td style={styles.td}>{fmt(p.entry, 4)}</td>
                      <td style={styles.td}>{fmt(p.stop, 4)}</td>
                      <td style={styles.td}>{fmt(p.qty, 6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ ...styles.sectionTitle, marginTop: 18 }}>EVENT JOURNAL (newest first)</div>
          {result.events.length === 0 ? (
            <div style={styles.empty}>No paper trades yet — the first weekly regime flip + breakout will appear here.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {result.events.map((e) => (
                <div key={e.key + e.time} style={{
                  ...styles.event,
                  borderColor: result.freshKeys.has(e.key) ? "#7cffb166" : "#2cff9c18",
                  background: result.freshKeys.has(e.key) ? "#0d3a2533" : "#06120e",
                }}>
                  <span style={{ opacity: 0.6, marginRight: 10 }}>{ymd(e.time)}</span>
                  <span style={{ color: kindColor[e.kind] || "#d7ffe8", fontWeight: 800, marginRight: 10 }}>{e.kind}</span>
                  {e.text}
                  {result.freshKeys.has(e.key) ? <span style={styles.newTag}>NEW</span> : null}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={styles.empty}>
          Click CHECK PAPER TRACK. This replays the entire paper phase through the
          validated engine — a few seconds of fetching, then the full journal.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, good, bad }) {
  return (
    <div style={styles.stat}>
      <div style={{ fontSize: 10, letterSpacing: 1.2, opacity: 0.6 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 900, marginTop: 4, color: bad ? "#ff7c9c" : good ? "#7cffb1" : "#d7ffe8" }}>{value}</div>
    </div>
  );
}

const styles = {
  page: { maxWidth: 1100, margin: "26px auto", padding: "0 14px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", color: "#d7ffe8" },
  header: {
    border: "1px solid #2cff9c33",
    background: "radial-gradient(1200px 280px at 10% 0%, #1cff8a22, transparent), linear-gradient(180deg, #07110e, #050807)",
    padding: 16, borderRadius: 18, boxShadow: "0 0 0 1px #0d2a1d inset, 0 30px 80px #00000088",
    display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center",
  },
  title: { margin: 0, letterSpacing: 3, fontWeight: 900, fontSize: 22 },
  subtitle: { marginTop: 6, opacity: 0.78, lineHeight: 1.3, fontSize: 12, maxWidth: 720 },
  btn: {
    padding: "10px 14px", borderRadius: 14, border: "1px solid #2cff9c33",
    background: "linear-gradient(180deg, #0b1712, #070b09)", color: "#d7ffe8",
    cursor: "pointer", letterSpacing: 1.4, fontWeight: 800, boxShadow: "0 10px 25px #00000088",
  },
  banner: { marginTop: 12, padding: 12, borderRadius: 14, border: "1px solid", fontSize: 13, fontWeight: 700 },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 14 },
  stat: { padding: 12, borderRadius: 14, border: "1px solid #2cff9c22", background: "#06120e" },
  sectionTitle: { marginTop: 16, marginBottom: 8, fontSize: 12, letterSpacing: 2, opacity: 0.85, fontWeight: 700 },
  tableWrap: { borderRadius: 14, border: "1px solid #2cff9c22", overflow: "auto", background: "#06120e" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left", padding: "9px 12px", borderBottom: "1px solid #2cff9c22", background: "#08120e", fontSize: 11, letterSpacing: 1, opacity: 0.9 },
  td: { padding: "9px 12px", borderBottom: "1px solid #2cff9c11", whiteSpace: "nowrap" },
  event: { padding: "9px 12px", borderRadius: 10, border: "1px solid", fontSize: 12, lineHeight: 1.5 },
  newTag: { marginLeft: 10, padding: "1px 7px", borderRadius: 999, background: "#0d3a25", color: "#7cffb1", fontSize: 10, fontWeight: 900, letterSpacing: 1 },
  empty: { padding: 20, borderRadius: 14, border: "1px dashed #2cff9c22", textAlign: "center", opacity: 0.65, fontSize: 13 },
};
