import { useEffect, useMemo, useState } from "react";
import { fetchKlines, dropUnclosedCandle, binanceSymbol, fetchDerivsContext } from "../data/binance.js";
import { runOne } from "../strategy/runOne.js";
import { estimateLiquidation, stopToLiqBufferPct, maxSafeLeverage } from "../strategy/liquidation.js";

const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const QUOTE = "USDT";
const WEEKLY_LIMIT = 200;
const DAILY_LIMIT = 200;

const LS_KEY = "scanner.config.v1";
const DEFAULT_CFG = { equity: 100000, riskPct: 1, fetchDerivs: false, leverage: 5, mmrPct: 0.5 };

const GRADE_COLORS = {
  CONFIRMED: { bg: "#0d3a25", fg: "#7cffb1" },
  NEUTRAL: { bg: "#1a1a1a", fg: "#999" },
  CAUTION: { bg: "#3a2a0d", fg: "#ffd17c" },
  CROWDED: { bg: "#3a0d1f", fg: "#ff7c9c" },
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
  LONG_OK: { bg: "#0d3a25", fg: "#7cffb1" },
  SHORT_OK: { bg: "#3a0d1f", fg: "#ff7c9c" },
  FLAT: { bg: "#1a1a1a", fg: "#888" },
  WARMUP: { bg: "#1a1a1a", fg: "#666" },
};

const ACTION_COLORS = {
  LONG: { bg: "#0d3a25", fg: "#7cffb1" },
  SHORT: { bg: "#3a0d1f", fg: "#ff7c9c" },
  VETO: { bg: "#3a2a0d", fg: "#ffd17c" },
  NONE: { bg: "#1a1a1a", fg: "#888" },
  WAIT: { bg: "#1a1a1a", fg: "#666" },
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

  useEffect(() => { saveCfg(cfg); }, [cfg]);

  async function runScan() {
    setStatus({ state: "loading", message: `Scanning ${UNIVERSE.length} assets...` });
    const results = await Promise.allSettled(
      UNIVERSE.map((asset) => scanAsset(asset, Number(cfg.equity) || 0, Number(cfg.riskPct) || 0, cfg.fetchDerivs)),
    );
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
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>SCANNER</h1>
          <div style={styles.subtitle}>
            Mechanical swing: weekly regime (50W SMA · MACD hist · ADX≥20 · RSI vs 50) →
            daily Donchian-20 breakout → 1% risk per trade, Donchian-10 trailing exit.
          </div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <button style={styles.btn} onClick={runScan} type="button" disabled={status.state === "loading"}>
            {status.state === "loading" ? "SCANNING..." : "RUN SCAN"}
          </button>
          {lastScan ? (
            <div style={{ fontSize: 11, opacity: 0.65, textAlign: "right" }}>
              Last: {lastScan.toLocaleTimeString()}
            </div>
          ) : null}
        </div>
      </div>

      <div style={styles.controls}>
        <div style={styles.controlField}>
          <label style={styles.label}>EQUITY (USDT)</label>
          <input
            value={cfg.equity}
            onChange={(e) => setCfg({ ...cfg, equity: e.target.value })}
            style={styles.input}
          />
        </div>
        <div style={styles.controlField}>
          <label style={styles.label}>RISK % PER TRADE</label>
          <input
            value={cfg.riskPct}
            onChange={(e) => setCfg({ ...cfg, riskPct: e.target.value })}
            style={styles.input}
          />
        </div>
        <div style={styles.controlField}>
          <label style={styles.label}>RISK $ (LOSS @ STOP)</label>
          <div style={styles.readonly}>
            {fmt((Number(cfg.equity) || 0) * (Number(cfg.riskPct) || 0) / 100, 2)} USDT
          </div>
        </div>
        <div style={styles.controlField}>
          <label style={styles.label}>LEVERAGE (ISOLATED)</label>
          <select
            value={String(cfg.leverage)}
            onChange={(e) => setCfg({ ...cfg, leverage: Number(e.target.value) })}
            style={styles.input}
          >
            {[1, 2, 3, 5, 8, 10, 15, 20, 25].map((l) => <option key={l} value={l}>{l}x</option>)}
          </select>
        </div>
        <div style={styles.controlField}>
          <label style={styles.label}>DERIVATIVES (FUNDING / OI)</label>
          <label style={{ ...styles.readonly, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!cfg.fetchDerivs}
              onChange={(e) => setCfg({ ...cfg, fetchDerivs: e.target.checked })}
            />
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              {cfg.fetchDerivs ? "On — fetches positioning per asset (slower)" : "Off — price/flow only"}
            </span>
          </label>
        </div>
      </div>

      <div style={styles.summary}>
        <Pill color="#0d3a25" text={`LONG-OK: ${summary.longOk}`} />
        <Pill color="#3a0d1f" text={`SHORT-OK: ${summary.shortOk}`} />
        <Pill color="#1a1a1a" text={`FLAT: ${summary.flat}`} />
        <Pill color="#0d2f3a" text={`SIGNALS: ${summary.entries}`} />
        <Pill color="#3a2a0d" text={`VETOES: ${summary.vetoes}`} />
        {status.message ? (
          <span style={{ marginLeft: 12, fontSize: 12, opacity: 0.75 }}>{status.message}</span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div style={styles.empty}>Click RUN SCAN. Manual refresh only — this is a once-a-day system.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Asset</th>
                <th style={styles.th}>Regime</th>
                <th style={styles.th}>Action</th>
                <th style={styles.th}>Close</th>
                <th style={styles.th}>Entry trigger</th>
                <th style={styles.th}>Stop</th>
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
                <Row key={r.asset} row={r} leverage={Number(cfg.leverage) || 5} mmrPct={Number(cfg.mmrPct) || 0.5} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={styles.foot}>
        Source: Binance spot {QUOTE} klines (1W, 1D), live unclosed candle excluded.
        Universe: {UNIVERSE.join(" · ")}. Backtest tab coming next.
      </div>
    </div>
  );
}

function Row({ row, leverage, mmrPct }) {
  if (!row.ok) {
    return (
      <tr>
        <td style={styles.td}>{row.asset}</td>
        <td style={styles.td} colSpan={21}>
          <span style={{ color: "#ff7c9c" }}>error: {row.error}</span>
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
      <td style={{ ...styles.td, fontWeight: 700 }}>{binanceSymbol(row.asset)}</td>
      <td style={styles.td}><StateBadge state={row.regimeState} /></td>
      <td style={styles.td}><ActionBadge action={sig.action || "WAIT"} reason={sig.reason} /></td>
      <td style={styles.td}>{fmt(sig.close, 4)}</td>
      <td style={styles.td}>
        {sig.action === "LONG" ? `> ${fmt(sig.entryUpper, 4)}` :
         sig.action === "SHORT" ? `< ${fmt(sig.entryLower, 4)}` : "-"}
      </td>
      <td style={styles.td}>{fmt(sig.stop, 4)}</td>
      <td style={styles.td}>{sz?.ok ? `${fmt(sz.stopDistPct, 2)}%` : "-"}</td>
      <td style={styles.td}>{sz?.ok ? fmt(sz.qty, 6) : "-"}</td>
      <td style={styles.td}>{sz?.ok ? fmt(sz.notional, 0) : "-"}</td>
      <td style={styles.td}>{margin !== null ? fmt(margin, 0) : "-"}</td>
      <td style={styles.td}>{liq !== null ? fmt(liq, 4) : "-"}</td>
      <td style={{ ...styles.td, color: liqDanger ? "#ff7c9c" : liqBuf !== null ? "#7cffb1" : "#888", fontWeight: liqDanger ? 800 : 400 }}
        title="Distance from stop to estimated liquidation. Below 2% = a wick can liquidate you before your stop fires — lower the leverage.">
        {liqBuf !== null ? `${fmt(liqBuf, 1)}%${liqDanger ? " ⚠" : ""}` : "-"}
      </td>
      <td style={styles.td} title="Largest leverage that keeps the stop ≥2% inside liquidation">
        {safeLev !== null ? `${safeLev}x` : hasSignal ? "none" : "-"}
      </td>
      <td style={styles.td}>{fmt(rl.sma, 2)}</td>
      <td style={{ ...styles.td, color: rl.hist > 0 ? "#7cffb1" : rl.hist < 0 ? "#ff7c9c" : "#888" }}>
        {fmt(rl.hist, 3)}
      </td>
      <td style={styles.td}>{fmt(rl.adx, 1)}</td>
      <td style={styles.td}>{fmt(rl.rsi, 1)}</td>
      <td style={styles.td}>{fmt(sig.rsi, 1)}</td>
      <td style={{ ...styles.td, color: flow > 0 ? "#7cffb1" : flow < 0 ? "#ff7c9c" : "#888" }} title="CVD slope over last 10 days (aggressor flow)">
        {flow === null || flow === undefined ? "-" : `${flow > 0 ? "▲" : "▼"} ${fmt(Math.abs(flow) * 100, 1)}`}
      </td>
      <td style={{ ...styles.td, color: d.fundingRate > 0 ? "#ff7c9c" : d.fundingRate < 0 ? "#7cffb1" : "#888" }}>
        {Number.isFinite(d.fundingRate) ? `${fmt(d.fundingRate * 100, 4)}%` : "-"}
      </td>
      <td style={{ ...styles.td, color: d.oiChange24hPct > 0 ? "#7cffb1" : d.oiChange24hPct < 0 ? "#ff7c9c" : "#888" }}>
        {Number.isFinite(d.oiChange24hPct) ? `${fmt(d.oiChange24hPct, 1)}%` : "-"}
      </td>
      <td style={styles.td}>{da ? <GradeBadge grade={da.grade} reasons={da.reasons} /> : "-"}</td>
    </tr>
  );
}

function GradeBadge({ grade, reasons }) {
  const c = GRADE_COLORS[grade] || GRADE_COLORS.NEUTRAL;
  return <span title={(reasons || []).join("\n")} style={{ ...styles.badge, background: c.bg, color: c.fg }}>{grade}</span>;
}

function StateBadge({ state }) {
  const c = STATE_COLORS[state] || STATE_COLORS.FLAT;
  return <span style={{ ...styles.badge, background: c.bg, color: c.fg }}>{state}</span>;
}
function ActionBadge({ action, reason }) {
  const c = ACTION_COLORS[action] || ACTION_COLORS.NONE;
  return <span title={reason || ""} style={{ ...styles.badge, background: c.bg, color: c.fg }}>{action}</span>;
}
function Pill({ color, text }) {
  return <span style={{ ...styles.pill, background: color }}>{text}</span>;
}

const styles = {
  page: {
    maxWidth: 1400, margin: "26px auto", padding: "0 14px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    color: "#d7ffe8",
  },
  header: {
    border: "1px solid #2cff9c33",
    background: "radial-gradient(1200px 280px at 10% 0%, #1cff8a22, transparent), linear-gradient(180deg, #07110e, #050807)",
    padding: 16, borderRadius: 18,
    boxShadow: "0 0 0 1px #0d2a1d inset, 0 30px 80px #00000088",
    display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center",
  },
  title: { margin: 0, letterSpacing: 3, fontWeight: 900, fontSize: 22 },
  subtitle: { marginTop: 6, opacity: 0.78, lineHeight: 1.3, fontSize: 12, maxWidth: 720 },
  btn: {
    padding: "10px 14px", borderRadius: 14,
    border: "1px solid #2cff9c33",
    background: "linear-gradient(180deg, #0b1712, #070b09)",
    color: "#d7ffe8", cursor: "pointer", letterSpacing: 1.4, fontWeight: 800,
    boxShadow: "0 10px 25px #00000088",
  },
  controls: {
    display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginTop: 14,
    padding: 14, borderRadius: 18, border: "1px solid #2cff9c22", background: "#06120e",
  },
  controlField: { display: "grid", gap: 6 },
  label: { fontSize: 11, letterSpacing: 1.2, opacity: 0.7 },
  input: {
    padding: 10, borderRadius: 12, border: "1px solid #2cff9c2a",
    background: "#050b09", color: "#d7ffe8", outline: "none",
  },
  readonly: { padding: 10, borderRadius: 12, border: "1px solid #2cff9c14", background: "#040806", color: "#d7ffe8", opacity: 0.85 },
  summary: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 14 },
  pill: {
    display: "inline-block", padding: "5px 10px", borderRadius: 999,
    border: "1px solid #2cff9c22", fontSize: 12,
  },
  badge: {
    display: "inline-block", padding: "3px 8px", borderRadius: 6,
    fontSize: 11, fontWeight: 800, letterSpacing: 1.2,
  },
  empty: { marginTop: 24, padding: 24, borderRadius: 18, border: "1px dashed #2cff9c22", textAlign: "center", opacity: 0.7, fontSize: 13 },
  tableWrap: { marginTop: 14, borderRadius: 18, border: "1px solid #2cff9c22", overflow: "auto", background: "#06120e" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: {
    textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #2cff9c22",
    background: "#08120e", position: "sticky", top: 0,
    fontSize: 11, letterSpacing: 1, opacity: 0.9, fontWeight: 700,
  },
  td: { padding: "10px 12px", borderBottom: "1px solid #2cff9c11", whiteSpace: "nowrap" },
  foot: { marginTop: 12, opacity: 0.55, fontSize: 11, lineHeight: 1.4 },
};
