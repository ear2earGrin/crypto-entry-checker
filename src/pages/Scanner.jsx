import { useEffect, useMemo, useState } from "react";
import { fetchKlines, dropUnclosedCandle, binanceSymbol, fetchDerivsContext } from "../data/binance.js";
import { runOne } from "../strategy/runOne.js";
import { estimateLiquidation, stopToLiqBufferPct, maxSafeLeverage } from "../strategy/liquidation.js";
import { T, TONE, ui, signColor } from "../ui/theme.js";
import { Page, PageHeader, Field } from "../ui/Page.jsx";
import { replayPaper, todaysOrders } from "../backtest/paperReplay.js";

const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const QUOTE = "USDT";
const WEEKLY_LIMIT = 200;
const DAILY_LIMIT = 200;

const LS_KEY = "scanner.config.v1";
// Defaults follow the 2026-10 audit: sizing never needs leverage (spot, 1x), and
// 0.35% is the risk its pre-registered drawdown rule allows. Saved settings win.
const DEFAULT_CFG = { equity: 100000, riskPct: 0.35, fetchDerivs: false, leverage: 1, mmrPct: 0.5 };

const GRADE_COLORS = {
  CONFIRMED: TONE.up,
  NEUTRAL: TONE.flat,
  CAUTION: TONE.warn,
  CROWDED: TONE.down,
};

function loadCfg() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_CFG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CFG, ...parsed };
  } catch {
    return DEFAULT_CFG;
  }
}
function saveCfg(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* empty */ }
}

function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

const STATE_COLORS = {
  LONG_OK: TONE.up,
  SHORT_OK: TONE.down,
  FLAT: TONE.flat,
  WARMUP: TONE.flat,
};

const ACTION_COLORS = {
  LONG: TONE.up,
  SHORT: TONE.down,
  VETO: TONE.warn,
  NONE: TONE.flat,
  WAIT: TONE.flat,
};

async function scanAsset(asset, equity, riskPct, fetchDerivs) {
  const [weekly, daily] = await Promise.all([
    fetchKlines({ asset, quote: QUOTE, timeframe: "1W", limit: WEEKLY_LIMIT }),
    fetchKlines({ asset, quote: QUOTE, timeframe: "1D", limit: DAILY_LIMIT }),
  ]);
  const w = dropUnclosedCandle(weekly);
  const d = dropUnclosedCandle(daily);
  // Derivatives are best-effort and only fetched when toggled on (adds ~4 requests
  // per asset). A failure here must not break the price-based scan.
  let derivs = null;
  if (fetchDerivs) {
    try { derivs = await fetchDerivsContext(asset); } catch { derivs = null; }
  }
  return runOne({ asset, weekly: w, daily: d, equity, riskPct, derivs });
}

export default function Scanner() {
  const [cfg, setCfg] = useState(loadCfg());
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [lastScan, setLastScan] = useState(null);
  // What the system actually does per coin (portfolio rules applied), from the
  // same replay the Paper tab and the robot run. null = not loaded / failed.
  const [system, setSystem] = useState(null);

  useEffect(() => { saveCfg(cfg); }, [cfg]);

  async function runScan() {
    setStatus({ state: "loading", message: `Scanning ${UNIVERSE.length} assets...` });
    const replay = replayPaper().then(systemByAsset).catch(() => null);
    const results = await Promise.allSettled(
      UNIVERSE.map((asset) => scanAsset(asset, Number(cfg.equity) || 0, Number(cfg.riskPct) || 0, cfg.fetchDerivs)),
    );
    setSystem(await replay);
    const next = results.map((r, i) => {
      if (r.status === "fulfilled") return { ok: true, ...r.value };
      return { ok: false, asset: UNIVERSE[i], error: r.reason?.message || "fetch failed" };
    });
    setRows(next);
    setLastScan(new Date());
    const errs = next.filter((r) => !r.ok).length;
    setStatus({
      state: errs ? "warn" : "ok",
      message: errs ? `Done with ${errs} error(s).` : "Scan complete.",
    });
  }

  const summary = useMemo(() => {
    const longOk = rows.filter((r) => r.ok && r.regimeState === "LONG_OK").length;
    const shortOk = rows.filter((r) => r.ok && r.regimeState === "SHORT_OK").length;
    const flat = rows.filter((r) => r.ok && r.regimeState === "FLAT").length;
    const entries = rows.filter((r) => r.ok && (r.signal?.action === "LONG" || r.signal?.action === "SHORT")).length;
    const vetoes = rows.filter((r) => r.ok && r.signal?.action === "VETO").length;
    return { longOk, shortOk, flat, entries, vetoes };
  }, [rows]);

  return (
    <Page>
      <PageHeader
        eyebrow="Daily signals · Crypto System v2.0"
        title="Scanner"
        actions={
          <>
            {lastScan ? <span style={ui.small}>Last scan {lastScan.toLocaleTimeString()}</span> : null}
            <button style={ui.btnPrimary} onClick={runScan} type="button" disabled={status.state === "loading"}>
              {status.state === "loading" ? "Scanning…" : "Run scan"}
            </button>
          </>
        }
      >
        <p className="muted">
          Mechanical swing v2.0 (validated 2026-07-18): weekly 50W-SMA regime →
          daily Donchian-20 breakout, LONG-ONLY → fixed-risk sizing, Donchian-10
          trailing exit. No vetoes, no shorts — the ablation showed they subtract.
        </p>
      </PageHeader>

      <div style={{ ...ui.banner, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
        <b>This table shows raw signals for every coin.</b> The portfolio rules (at most 4 positions: 1 of BTC/ETH plus
        3 others, one new entry a day, cooldowns) are applied only in the <b>System</b> column. For what to buy and
        where your stops go today, use the <a href="#/paper">PAPER tab&apos;s Today&apos;s orders</a>.
      </div>

      <section style={ui.panel} aria-label="Scan settings">
        <div style={ui.controls}>
          <Field label="Equity (USDT)">
            <input
              value={cfg.equity}
              onChange={(e) => setCfg({ ...cfg, equity: e.target.value })}
              style={ui.input}
            />
          </Field>
          <Field label="Risk % per trade">
            <input
              value={cfg.riskPct}
              onChange={(e) => setCfg({ ...cfg, riskPct: e.target.value })}
              style={ui.input}
            />
          </Field>
          <Field label="Risk $ (loss @ stop)">
            <div style={ui.readonly}>
              {fmt((Number(cfg.equity) || 0) * (Number(cfg.riskPct) || 0) / 100, 2)} USDT
            </div>
          </Field>
          <Field label="Leverage (isolated)">
            <select
              value={String(cfg.leverage)}
              onChange={(e) => setCfg({ ...cfg, leverage: Number(e.target.value) })}
              style={ui.input}
            >
              {[1, 2, 3, 5, 8, 10, 15, 20, 25].map((l) => <option key={l} value={l}>{l}x</option>)}
            </select>
          </Field>
          <Field label="Derivatives (funding / OI)">
            <label style={{ ...ui.input, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!cfg.fetchDerivs}
                onChange={(e) => setCfg({ ...cfg, fetchDerivs: e.target.checked })}
              />
              <span style={{ fontSize: 12.5, color: T.muted }}>
                {cfg.fetchDerivs ? "On — fetches positioning per asset (slower)" : "Off — price/flow only"}
              </span>
            </label>
          </Field>
        </div>
      </section>

      <div style={styles.summary}>
        <Pill tone={TONE.up} text={`Bull (longs allowed): ${summary.longOk}`} />
        <Pill tone={TONE.down} text={`Bear (stand aside): ${summary.shortOk}`} />
        <Pill tone={TONE.flat} text={`Flat: ${summary.flat}`} />
        <Pill tone={TONE.info} text={`Signals: ${summary.entries}`} />
        <Pill tone={TONE.warn} text={`Vetoes: ${summary.vetoes}`} />
        {status.message ? (
          <span style={{ ...ui.small, marginLeft: 6 }}>{status.message}</span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div style={ui.empty}>Click RUN SCAN. Manual refresh only — this is a once-a-day system.</div>
      ) : (
        <div style={ui.tableWrap}>
          <table style={ui.table}>
            <thead>
              <tr>
                <th style={styles.th}>Asset</th>
                <th style={styles.th} title="What the system actually does today, with every portfolio rule applied (same engine as the Paper tab and the robot)">System</th>
                <th style={styles.th}>Regime</th>
                <th style={styles.th}>Action</th>
                <th style={styles.th}>Close</th>
                <th style={styles.th}>Entry trigger</th>
                <th style={styles.th}>Stop</th>
                <th style={styles.th}>D10 exit</th>
                <th style={styles.th}>Stop dist</th>
                <th style={styles.th}>Qty</th>
                <th style={styles.th}>Notional</th>
                <th style={styles.th}>Margin</th>
                <th style={styles.th}>Liq ≈</th>
                <th style={styles.th}>Stop→Liq</th>
                <th style={styles.th}>Max lev</th>
                <th style={styles.th}>50W SMA</th>
                <th style={styles.th}>W MACD hist</th>
                <th style={styles.th}>W ADX</th>
                <th style={styles.th}>W RSI</th>
                <th style={styles.th}>D RSI</th>
                <th style={styles.th}>Flow</th>
                <th style={styles.th}>Funding</th>
                <th style={styles.th}>OI 24h</th>
                <th style={styles.th}>Derivs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.asset} row={r} sys={system ? system[r.asset] || { kind: "NONE" } : null} leverage={Number(cfg.leverage) || 1} mmrPct={Number(cfg.mmrPct) || 0.5} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={ui.foot}>
        Source: Binance spot {QUOTE} klines (1W, 1D), live unclosed candle excluded.
        Universe: {UNIVERSE.join(" · ")}.
      </p>
    </Page>
  );
}

function Row({ row, sys, leverage, mmrPct }) {
  if (!row.ok) {
    return (
      <tr>
        <td style={styles.td}>{row.asset}</td>
        <td style={styles.td} colSpan={23}>
          <span style={{ color: T.down }}>error: {row.error}</span>
        </td>
      </tr>
    );
  }
  const sig = row.signal || {};
  const rl = row.regimeLatest || {};
  const sz = row.sizing;
  const d = row.derivs || {};
  const flow = row.flowSlope;
  const da = row.derivsAssessment;

  // Leverage / liquidation math for actionable signals only.
  const hasSignal = sig.action === "LONG" || sig.action === "SHORT";
  const liq = hasSignal
    ? estimateLiquidation({ entry: sig.close, direction: sig.action, leverage, mmrPct })
    : null;
  const liqBuf = hasSignal
    ? stopToLiqBufferPct({ entry: sig.close, stop: sig.stop, direction: sig.action, leverage, mmrPct })
    : null;
  const safeLev = hasSignal
    ? maxSafeLeverage({ entry: sig.close, stop: sig.stop, direction: sig.action, mmrPct })
    : null;
  const margin = hasSignal && sz?.ok ? sz.notional / leverage : null;
  const liqDanger = liqBuf !== null && liqBuf < 2;

  return (
    <tr>
      <td style={{ ...styles.td, fontFamily: T.body, fontWeight: 600, color: T.ink }}>{binanceSymbol(row.asset)}</td>
      <td style={styles.td}><SystemBadge sys={sys} /></td>
      <td style={styles.td}><StateBadge state={row.regimeState} /></td>
      <td style={styles.td}><ActionBadge action={sig.action || "WAIT"} reason={sig.reason} /></td>
      <td style={styles.td}>{fmt(sig.close, 4)}</td>
      <td style={styles.td}>
        {sig.action === "LONG" ? `> ${fmt(sig.entryUpper, 4)}` :
         sig.action === "SHORT" ? `< ${fmt(sig.entryLower, 4)}` : "-"}
      </td>
      <td style={styles.td}>{fmt(sig.stop, 4)}</td>
      <td style={styles.td} title="10-day trailing stop level. If you hold this coin, keep a resting stop-market sell here: it fires intraday as soon as price trades through it, not on the daily close. Raise it daily, never lower it.">
        {fmt(sig.exitLower, 4)}
      </td>
      <td style={styles.td}>{sz?.ok ? `${fmt(sz.stopDistPct, 2)}%` : "-"}</td>
      <td style={styles.td}>{sz?.ok ? fmt(sz.qty, 6) : "-"}</td>
      <td style={styles.td}>{sz?.ok ? fmt(sz.notional, 0) : "-"}</td>
      <td style={styles.td}>{margin !== null ? fmt(margin, 0) : "-"}</td>
      <td style={styles.td}>{liq !== null ? fmt(liq, 4) : "-"}</td>
      <td style={{ ...styles.td, color: liqDanger ? T.down : liqBuf !== null ? T.up : T.muted, fontWeight: liqDanger ? 600 : 400 }}
        title="Distance from stop to estimated liquidation. Below 2% = a wick can liquidate you before your stop fires — lower the leverage.">
        {liqBuf !== null ? `${fmt(liqBuf, 1)}%${liqDanger ? " ⚠" : ""}` : "-"}
      </td>
      <td style={styles.td} title="Largest leverage that keeps the stop ≥2% inside liquidation">
        {safeLev !== null ? `${safeLev}x` : hasSignal ? "none" : "-"}
      </td>
      <td style={styles.td}>{fmt(rl.sma, 2)}</td>
      <td style={{ ...styles.td, color: signColor(rl.hist) }}>
        {fmt(rl.hist, 3)}
      </td>
      <td style={styles.td}>{fmt(rl.adx, 1)}</td>
      <td style={styles.td}>{fmt(rl.rsi, 1)}</td>
      <td style={styles.td}>{fmt(sig.rsi, 1)}</td>
      <td style={{ ...styles.td, color: signColor(flow) }} title="CVD slope over last 10 days (aggressor flow)">
        {flow === null || flow === undefined ? "-" : `${flow > 0 ? "▲" : "▼"} ${fmt(Math.abs(flow) * 100, 1)}`}
      </td>
      <td style={{ ...styles.td, color: signColor(-d.fundingRate) }}>
        {Number.isFinite(d.fundingRate) ? `${fmt(d.fundingRate * 100, 4)}%` : "-"}
      </td>
      <td style={{ ...styles.td, color: signColor(d.oiChange24hPct) }}>
        {Number.isFinite(d.oiChange24hPct) ? `${fmt(d.oiChange24hPct, 1)}%` : "-"}
      </td>
      <td style={styles.td}>{da ? <GradeBadge grade={da.grade} reasons={da.reasons} /> : "-"}</td>
    </tr>
  );
}

/** asset -> { kind: "HELD" | "BUY" | "NONE", stop?, since? } from the paper replay. */
function systemByAsset(replay) {
  const o = todaysOrders(replay);
  const out = {};
  for (const s of o.stops) out[s.asset] = { kind: s.isNew ? "BUY" : "HELD", stop: s.stop, since: s.entryTime };
  return out;
}

function SystemBadge({ sys }) {
  if (sys === null) return <span style={{ color: T.muted }}>–</span>;
  const map = { BUY: [TONE.up, "BUY TODAY"], HELD: [TONE.info, "HELD"], NONE: [TONE.flat, "NO TRADE"] };
  const [tone, label] = map[sys.kind] || map.NONE;
  const title = sys.kind === "NONE"
    ? "The system holds no position here and takes no entry today (no signal, or a portfolio rule blocks it)."
    : `Resting stop ${sys.stop}${sys.kind === "HELD" ? "; held since " + new Date(sys.since * 1000).toISOString().slice(0, 10) : ""}`;
  return <span title={title} style={{ ...styles.badge, background: tone.bg, color: tone.fg }}>{label}{sys.stop ? ` · stop ${fmt(sys.stop, 4)}` : ""}</span>;
}

function GradeBadge({ grade, reasons }) {
  const c = GRADE_COLORS[grade] || GRADE_COLORS.NEUTRAL;
  return <span title={(reasons || []).join("\n")} style={{ ...styles.badge, background: c.bg, color: c.fg }}>{grade}</span>;
}

function StateBadge({ state }) {
  const c = STATE_COLORS[state] || STATE_COLORS.FLAT;
  // v2.0 is long-only: a bear regime does NOT mean "go short" — it means buying
  // is forbidden. Label it as the instruction, not the raw state.
  const label = state === "SHORT_OK" ? "BEAR — NO LONGS" : state === "LONG_OK" ? "BULL — LONGS OK" : state;
  const title = state === "SHORT_OK"
    ? "Price is below the 50W SMA. System is long-only: DO NOT buy, DO NOT short. Stand aside."
    : state === "LONG_OK" ? "Price is above the 50W SMA. Breakout signals may fire." : "";
  return <span title={title} style={{ ...styles.badge, background: c.bg, color: c.fg }}>{label}</span>;
}
function ActionBadge({ action, reason }) {
  const c = ACTION_COLORS[action] || ACTION_COLORS.NONE;
  return <span title={reason || ""} style={{ ...styles.badge, background: c.bg, color: c.fg }}>{action}</span>;
}
function Pill({ tone, text }) {
  return <span style={{ ...ui.chip, borderColor: tone.fg, color: tone.fg }}>{text}</span>;
}

const styles = {
  summary: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  badge: ui.badge,
  th: ui.th,
  td: ui.td,
};
