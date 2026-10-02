import { useState } from "react";
import { replayPaper, todaysOrders, scaleToAccount, PAPER_CFG } from "../backtest/paperReplay.js";
import { markOpenPosition } from "../backtest/markToMarket.js";
import { estimateLiquidation, stopToLiqBufferPct } from "../strategy/liquidation.js";
import { PAPER_EPOCH, PRODUCTION_COSTS } from "../strategy/presets.js";
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

const CFG = { ...PAPER_CFG, ...PRODUCTION_COSTS };
const SEEN_KEY = "paperSeen.v1";
// The robot sizes by risk and never uses leverage, so margin is shown for the
// leverage you would trade it at. Defaults to the Scanner's setting.
const LEV_KEY = "paper.leverage.v1";
const LEVERAGES = [1, 2, 3, 5, 8, 10, 15, 20, 25];
const MMR_PCT = 0.5; // maintenance margin %, same default as the Scanner
function loadLeverage() {
  try {
    const own = Number(localStorage.getItem(LEV_KEY));
    if (LEVERAGES.includes(own)) return own;
    const scanner = Number(JSON.parse(localStorage.getItem("scanner.config.v1") || "{}").leverage);
    if (LEVERAGES.includes(scanner)) return scanner;
  } catch { /* empty */ }
  return 1;
}

// Your own account, for sizing today's orders (per viewer, this browser only).
// Risk defaults to 0.35%, the level the 2026-10 audit's pre-registered rule gives.
const ACCT_KEY = "paper.account.v1";
function loadAccount() {
  try {
    const a = JSON.parse(localStorage.getItem(ACCT_KEY) || "{}");
    return { equity: Number(a.equity) > 0 ? Number(a.equity) : 100000, riskPct: Number(a.riskPct) > 0 ? Number(a.riskPct) : 0.35 };
  } catch { return { equity: 100000, riskPct: 0.35 }; }
}

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

export default function PaperTrack() {
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [result, setResult] = useState(null);
  const [leverage, setLeverageState] = useState(loadLeverage);
  const setLeverage = (v) => {
    setLeverageState(v);
    try { localStorage.setItem(LEV_KEY, String(v)); } catch { /* empty */ }
  };
  const [account, setAccountState] = useState(loadAccount);
  const setAccount = (patch) => {
    const next = { ...account, ...patch };
    setAccountState(next);
    try { localStorage.setItem(ACCT_KEY, JSON.stringify(next)); } catch { /* empty */ }
  };

  async function check() {
    setStatus({ state: "loading", message: `Replaying paper track since ${PAPER_EPOCH}...` });
    try {
      const { res, epochSec, markByAsset, todayTime, failed } = await replayPaper();
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
        orders: todaysOrders({ res, epochSec, todayTime }), todayTime,
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

  // Margin, ROE and liquidation depend only on the chosen leverage, so they
  // are derived per render and the selector updates them without a refetch.
  const rows = (result?.open || []).map((p) => {
    const notional = p.qty * p.entry;
    const margin = notional / leverage;
    const liq = estimateLiquidation({ entry: p.entry, direction: p.direction, leverage, mmrPct: MMR_PCT });
    const liqBuf = stopToLiqBufferPct({ entry: p.entry, stop: p.stop, direction: p.direction, leverage, mmrPct: MMR_PCT });
    return { ...p, notional, margin, roe: p.now ? (p.now.net / margin) * 100 : null, liq, liqDanger: liqBuf !== null && liqBuf < 2 };
  });
  const totalNotional = rows.reduce((s, r) => s + r.notional, 0);
  const totalMargin = rows.reduce((s, r) => s + r.margin, 0);
  const equityNow = CFG.equity + (result ? result.pnl + result.unrealized : 0);

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
          {/* Wider tiles: 4 per row on desktop, so the track stats and the
              open-position money (unrealized / total / margin) get a row each. */}
          <div style={{ ...ui.tiles, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
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
            <Tile
              label={`Margin in use @ ${leverage}x`}
              value={`${fmt(totalMargin, 0)} USDT`}
              sub={rows.length ? `${fmt((totalMargin / equityNow) * 100, 1)}% of equity · exposure ${fmt(totalNotional / equityNow, 2)}x` : "no open positions"}
            />
          </div>

          <TodaysOrders result={result} account={account} setAccount={setAccount} />

          <div className="panel-head">
            <h2 style={ui.h2}>Open paper positions</h2>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={ui.label}>Leverage (isolated)</span>
              <select value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} style={{ ...ui.input, width: "auto", padding: "4px 8px" }}>
                {LEVERAGES.map((l) => <option key={l} value={l}>{l}x</option>)}
              </select>
            </label>
          </div>
          {result.open.length === 0 ? (
            <div style={ui.empty}>None — the system is in cash. In a bear regime, that IS the position.</div>
          ) : (
            <div style={ui.tableWrap}>
              <table style={ui.table}>
                <thead><tr>
                  <th style={styles.th}>Asset</th><th style={styles.th}>Since</th><th style={styles.th}>Entry</th>
                  <th style={styles.th}>Now</th><th style={styles.th}>Move</th>
                  <th style={styles.th}>Unrealized PnL</th><th style={styles.th}>ROE</th><th style={styles.th}>R</th>
                  <th style={styles.th}>Size</th><th style={styles.th}>Leverage</th><th style={styles.th}>Initial margin</th><th style={styles.th}>Liq ≈</th>
                  <th style={styles.th}>Current stop</th><th style={styles.th}>At stop</th><th style={styles.th}>Qty</th>
                </tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.asset + p.entryTime}>
                      <td style={{ ...styles.td, fontFamily: T.body, fontWeight: 600 }}>{p.asset}</td>
                      <td style={styles.td}>{ymd(p.entryTime)}</td>
                      <td style={styles.td}>{fmt(p.entry, 4)}</td>
                      <td style={styles.td}>{p.now ? fmt(p.now.price, 4) : "-"}</td>
                      <td style={{ ...styles.td, color: signColor(p.now?.movePct) }}>{p.now ? `${p.now.movePct >= 0 ? "+" : ""}${fmt(p.now.movePct, 2)}%` : "-"}</td>
                      <td style={{ ...styles.td, color: signColor(p.now?.net), fontWeight: 500 }}>{p.now ? `${fmt(p.now.net, 0)} USDT` : "-"}</td>
                      <td style={{ ...styles.td, color: signColor(p.roe) }} title="Unrealized PnL ÷ initial margin, as the exchange shows it">{p.roe !== null ? `${p.roe >= 0 ? "+" : ""}${fmt(p.roe, 1)}%` : "-"}</td>
                      <td style={{ ...styles.td, color: signColor(p.now?.r) }}>{p.now ? `${fmt(p.now.r, 2)}R` : "-"}</td>
                      <td style={styles.td} title="Position size at entry (qty × entry)">{fmt(p.notional, 0)} USDT</td>
                      <td style={styles.td}>{leverage}x</td>
                      <td style={styles.td}>{fmt(p.margin, 0)} USDT</td>
                      <td style={{ ...styles.td, color: p.liqDanger ? T.down : undefined }}
                        title="Approximate isolated liquidation price at this leverage. Red = within 2% of (or past) the stop: a wick could liquidate before the stop fires.">
                        {p.liq !== null ? `${fmt(p.liq, 4)}${p.liqDanger ? " ⚠" : ""}` : "-"}
                      </td>
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
              position nets if its current trailing stop is hit; positive means profit is already locked in. The robot
              sizes by risk and uses no leverage, so initial margin, ROE and liquidation are for the leverage you pick
              (position size ÷ leverage; liquidation is an isolated-margin estimate at {MMR_PCT}% maintenance margin).
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

/**
 * The day's instructions, read off the engine: buys filled at today's open,
 * the stop every open position should have resting on the exchange, and
 * positions a stop closed yesterday. Quantities are scaled from the paper
 * robot's 1% sizing to your account and risk.
 */
function TodaysOrders({ result, account, setAccount }) {
  const { orders, todayTime } = result;
  if (!orders) return null;
  const size = (p) => scaleToAccount(p, account);
  const day = todayTime ? new Date(todayTime * 1000).toISOString().slice(0, 10) : "today";
  return (
    <section style={{ ...ui.panel, borderColor: "var(--accent)" }} aria-label="Today's orders">
      <div className="panel-head">
        <h2 style={ui.h2}>Today&apos;s orders · {day}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={ui.label}>Your account (USDT)</span>
            <input id="acct-equity" inputMode="decimal" value={account.equity} onChange={(e) => setAccount({ equity: Number(e.target.value.replace(",", ".")) || 0 })} style={{ ...ui.input, width: 120, padding: "4px 8px" }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={ui.label}>Risk per trade %</span>
            <input id="acct-risk" inputMode="decimal" value={account.riskPct} onChange={(e) => setAccount({ riskPct: Number(e.target.value.replace(",", ".")) || 0 })} style={{ ...ui.input, width: 70, padding: "4px 8px" }} />
          </label>
        </div>
      </div>

      {orders.buys.length === 0 && orders.stoppedOut.length === 0 ? (
        <p className="muted">No new entries or exits today. Keep the resting stops below in place.</p>
      ) : null}

      {orders.buys.map((p) => {
        const q = size(p);
        return (
          <div key={"b" + p.asset} style={{ ...ui.bannerGood }}>
            <b>BUY {p.asset}</b> at market now (the system filled at today&apos;s open, {fmt(p.entry, 4)}): about <b className="mono">{fmt(q, 6)}</b> {p.asset}
            {q ? <> ≈ {fmt(q * p.entry, 0)} USDT</> : null}. Then place a <b>stop-market sell at {fmt(p.stop, 4)}</b> for the whole position.
          </div>
        );
      })}

      {orders.stoppedOut.map((t) => (
        <div key={"x" + t.asset + t.exitTime} style={{ ...ui.bannerWarn }}>
          <b>{t.asset} closed yesterday</b> by its stop at {fmt(t.exit, 4)}. If your exchange stop filled, nothing to do. If it did not, sell the position now.
        </div>
      ))}

      {orders.stops.length ? (
        <div style={ui.tableWrap}>
          <table style={ui.table}>
            <thead><tr>
              <th style={styles.th}>Asset</th><th style={styles.th}>Resting stop (sell, stop-market)</th>
              <th style={styles.th}>Your size</th><th style={styles.th}>Since</th>
            </tr></thead>
            <tbody>
              {orders.stops.map((s) => (
                <tr key={"s" + s.asset}>
                  <td style={{ ...styles.td, fontFamily: T.body, fontWeight: 600 }}>{s.asset}{s.isNew ? <span style={styles.newTag}>NEW</span> : null}</td>
                  <td style={{ ...styles.td, color: T.accent }}>{fmt(s.stop, 4)}</td>
                  <td style={styles.td}>{fmt(size(s), 6)}</td>
                  <td style={styles.td}>{ymd(s.entryTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p style={ui.foot}>
        Act after the daily close (00:00 UTC), 7 days a week. Use market orders for entries, never a limit at the
        close. Move each resting stop up to the level shown; it never moves down. Sizes are the paper robot&apos;s
        positions scaled to your account and risk ({fmt(account.riskPct, 2)}% of {fmt(account.equity, 0)} USDT);
        spot needs no leverage.
      </p>
    </section>
  );
}

const styles = {
  journalHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px" },
  th: ui.th,
  td: ui.td,
  event: { padding: "9px 12px", borderRadius: 6, border: "1px solid", fontSize: 13, lineHeight: 1.5 },
  newTag: { ...ui.badge, marginLeft: 10, background: "var(--up-bg)", color: "var(--up)", border: "1px solid var(--up)" },
};
