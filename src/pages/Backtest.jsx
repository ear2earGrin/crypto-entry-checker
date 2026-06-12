import { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";
import { fetchKlinesRange, dropUnclosedCandle, binanceSymbol } from "../data/binance.js";
import { backtestOne } from "../backtest/engine.js";
import { computeMetrics } from "../backtest/metrics.js";

const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const START_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const LS_KEY = "backtest.config.v1";
const DEFAULT_CFG = { asset: "BTC", startYear: 2020, equity: 100000, riskPct: 1, feePct: 0.08 };

function loadCfg() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_CFG;
    return { ...DEFAULT_CFG, ...JSON.parse(raw) };
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
function fmtDate(unixSecs) {
  if (!unixSecs) return "-";
  return new Date(unixSecs * 1000).toISOString().slice(0, 10);
}

export default function Backtest() {
  const [cfg, setCfg] = useState(loadCfg());
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [result, setResult] = useState(null);

  const chartDivRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => { saveCfg(cfg); }, [cfg]);

  useEffect(() => {
    const el = chartDivRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || 800,
      height: 300,
      layout: { background: { color: "#050807" }, textColor: "#d7ffe8" },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    const series = chart.addAreaSeries({
      lineColor: "#2cff9c",
      topColor: "#2cff9c33",
      bottomColor: "#2cff9c05",
      lineWidth: 2,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => chart.applyOptions({ width: el.clientWidth || 800 });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      try { chart.remove(); } catch { /* empty */ }
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!result || !seriesRef.current) return;
    seriesRef.current.setData(
      result.equityCurve.map((p) => ({ time: p.time, value: p.equity })),
    );
    try { chartRef.current?.timeScale()?.fitContent(); } catch { /* empty */ }
  }, [result]);

  async function run() {
    setStatus({ state: "loading", message: "Fetching history..." });
    setResult(null);
    try {
      const startTime = Date.UTC(Number(cfg.startYear), 0, 1);
      const [weeklyRaw, dailyRaw] = await Promise.all([
        // weekly needs ~50 extra bars of warmup history before the start date for the 50W SMA
        fetchKlinesRange({ asset: cfg.asset, timeframe: "1W", startTime: startTime - 55 * 7 * 86400 * 1000 }),
        fetchKlinesRange({ asset: cfg.asset, timeframe: "1D", startTime }),
      ]);
      const weekly = dropUnclosedCandle(weeklyRaw);
      const daily = dropUnclosedCandle(dailyRaw);

      if (daily.length < 60) throw new Error(`Only ${daily.length} daily candles — not enough history for ${cfg.asset} from ${cfg.startYear}.`);

      setStatus({ state: "loading", message: `Replaying ${daily.length} days...` });

      const bt = backtestOne({
        asset: cfg.asset,
        weekly,
        daily,
        startEquity: Number(cfg.equity) || 100000,
        riskPct: Number(cfg.riskPct) || 1,
        feePct: Number(cfg.feePct) || 0,
      });
      const metrics = computeMetrics(bt);
      setResult({ ...bt, metrics, candles: daily.length });
      setStatus({ state: "ok", message: `Done: ${daily.length} days, ${bt.trades.length} trades.` });
    } catch (e) {
      setStatus({ state: "error", message: e?.message || "Backtest failed." });
    }
  }

  const m = result?.metrics;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>BACKTEST</h1>
          <div style={styles.subtitle}>
            Same rules the Scanner runs live: weekly regime → daily Donchian-20 breakout →
            fixed-fractional risk → Donchian-10 trail. If you wouldn't have followed this
            equity curve through its worst stretch, don't trade it live.
          </div>
        </div>
        <button style={styles.btn} onClick={run} type="button" disabled={status.state === "loading"}>
          {status.state === "loading" ? "RUNNING..." : "RUN BACKTEST"}
        </button>
      </div>

      <div style={styles.controls}>
        <Field label="ASSET">
          <select value={cfg.asset} onChange={(e) => setCfg({ ...cfg, asset: e.target.value })} style={styles.input}>
            {UNIVERSE.map((a) => <option key={a} value={a}>{binanceSymbol(a)}</option>)}
          </select>
        </Field>
        <Field label="FROM YEAR">
          <select value={cfg.startYear} onChange={(e) => setCfg({ ...cfg, startYear: e.target.value })} style={styles.input}>
            {START_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="START EQUITY">
          <input value={cfg.equity} onChange={(e) => setCfg({ ...cfg, equity: e.target.value })} style={styles.input} />
        </Field>
        <Field label="RISK %">
          <input value={cfg.riskPct} onChange={(e) => setCfg({ ...cfg, riskPct: e.target.value })} style={styles.input} />
        </Field>
        <Field label="FEE % (ROUND-TRIP)">
          <input value={cfg.feePct} onChange={(e) => setCfg({ ...cfg, feePct: e.target.value })} style={styles.input} />
        </Field>
      </div>

      {status.message ? (
        <div style={{ marginTop: 10, fontSize: 12, color: status.state === "error" ? "#ff7c9c" : "#d7ffe8", opacity: 0.85 }}>
          {status.state === "error" ? "⚠️ " : ""}{status.message}
        </div>
      ) : null}

      <div style={styles.chartCard}>
        <div style={styles.sectionTitle}>EQUITY CURVE</div>
        <div ref={chartDivRef} style={{ borderRadius: 14, overflow: "hidden" }} />
      </div>

      {m ? (
        <>
          <div style={styles.metricsGrid}>
            <Metric label="Trades" value={String(m.numTrades)} />
            <Metric label="Win rate" value={`${fmt(m.winRate * 100, 1)}%`} />
            <Metric label="Expectancy" value={`${fmt(m.expectancyR, 2)}R`} sub={`${fmt(m.expectancy, 0)} USDT`} />
            <Metric label="Profit factor" value={m.profitFactor === Infinity ? "∞" : fmt(m.profitFactor, 2)} />
            <Metric label="Total return" value={`${fmt(m.totalReturnPct, 1)}%`} sub={`${fmt(m.totalReturn, 0)} USDT`} good={m.totalReturn > 0} bad={m.totalReturn < 0} />
            <Metric label="CAGR" value={`${fmt(m.cagr, 1)}%`} />
            <Metric label="Max drawdown" value={`${fmt(m.maxDDPct, 1)}%`} sub={`${fmt(m.maxDD, 0)} USDT / ${fmt(m.maxDDDays, 0)}d`} bad={m.maxDDPct > 20} />
            <Metric label="Avg hold" value={`${fmt(m.avgBarsHeld, 0)} days`} />
            <Metric label="Avg win" value={fmt(m.avgWin, 0)} />
            <Metric label="Avg loss" value={fmt(m.avgLoss, 0)} />
            <Metric label="Best trade" value={fmt(m.bestTrade?.pnl, 0)} />
            <Metric label="Worst trade" value={fmt(m.worstTrade?.pnl, 0)} />
          </div>

          {m.maxDDPct > 20 ? (
            <div style={styles.warnBanner}>
              ⚠️ Max drawdown {fmt(m.maxDDPct, 1)}% exceeds your 20% circuit-breaker threshold.
              Either reduce risk % or accept that you WILL see this drawdown live and plan for it.
            </div>
          ) : null}

          <div style={styles.tableWrap}>
            <div style={{ ...styles.sectionTitle, padding: "12px 12px 0" }}>TRADES ({result.trades.length})</div>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Dir</th>
                  <th style={styles.th}>Entry date</th>
                  <th style={styles.th}>Entry</th>
                  <th style={styles.th}>Exit date</th>
                  <th style={styles.th}>Exit</th>
                  <th style={styles.th}>Days</th>
                  <th style={styles.th}>PnL</th>
                  <th style={styles.th}>R</th>
                  <th style={styles.th}>Exit reason</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{i + 1}</td>
                    <td style={{ ...styles.td, color: t.direction === "LONG" ? "#7cffb1" : "#ff7c9c", fontWeight: 700 }}>{t.direction}</td>
                    <td style={styles.td}>{fmtDate(t.entryTime)}</td>
                    <td style={styles.td}>{fmt(t.entry, 4)}</td>
                    <td style={styles.td}>{fmtDate(t.exitTime)}</td>
                    <td style={styles.td}>{fmt(t.exit, 4)}</td>
                    <td style={styles.td}>{t.barsHeld}</td>
                    <td style={{ ...styles.td, color: t.pnl >= 0 ? "#7cffb1" : "#ff7c9c" }}>{fmt(t.pnl, 0)}</td>
                    <td style={{ ...styles.td, color: t.rMultiple >= 0 ? "#7cffb1" : "#ff7c9c" }}>{fmt(t.rMultiple, 2)}</td>
                    <td style={{ ...styles.td, opacity: 0.7 }}>{t.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={styles.empty}>
          Pick asset + start year, click RUN BACKTEST. Single asset for now — portfolio-level
          replay (correlation caps, 1-entry-per-day across assets) comes later.
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

function Metric({ label, value, sub, good, bad }) {
  return (
    <div style={styles.metric}>
      <div style={{ fontSize: 10, letterSpacing: 1.2, opacity: 0.6 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 20, fontWeight: 900, marginTop: 4, color: bad ? "#ff7c9c" : good ? "#7cffb1" : "#d7ffe8" }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
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
  subtitle: { marginTop: 6, opacity: 0.78, lineHeight: 1.3, fontSize: 12, maxWidth: 760 },
  btn: {
    padding: "10px 14px", borderRadius: 14, border: "1px solid #2cff9c33",
    background: "linear-gradient(180deg, #0b1712, #070b09)",
    color: "#d7ffe8", cursor: "pointer", letterSpacing: 1.4, fontWeight: 800,
    boxShadow: "0 10px 25px #00000088",
  },
  controls: {
    display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginTop: 14,
    padding: 14, borderRadius: 18, border: "1px solid #2cff9c22", background: "#06120e",
  },
  label: { fontSize: 11, letterSpacing: 1.2, opacity: 0.7 },
  input: {
    padding: 10, borderRadius: 12, border: "1px solid #2cff9c2a",
    background: "#050b09", color: "#d7ffe8", outline: "none", width: "100%",
  },
  sectionTitle: { margin: 0, letterSpacing: 2, fontSize: 12, opacity: 0.9, fontWeight: 700 },
  chartCard: {
    marginTop: 14, padding: 14, borderRadius: 18,
    border: "1px solid #2cff9c22", background: "linear-gradient(180deg, #06120e, #050807)",
    display: "grid", gap: 10,
  },
  metricsGrid: {
    display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginTop: 14,
  },
  metric: {
    padding: 12, borderRadius: 14, border: "1px solid #2cff9c22", background: "#06120e",
  },
  warnBanner: {
    marginTop: 12, padding: 12, borderRadius: 14,
    border: "1px solid #ffd17c44", background: "#1a1408", color: "#ffd17c", fontSize: 12, lineHeight: 1.4,
  },
  tableWrap: { marginTop: 14, borderRadius: 18, border: "1px solid #2cff9c22", overflow: "auto", background: "#06120e", maxHeight: 480 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 },
  th: {
    textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #2cff9c22",
    background: "#08120e", position: "sticky", top: 0, fontSize: 11, letterSpacing: 1, opacity: 0.9,
  },
  td: { padding: "8px 12px", borderBottom: "1px solid #2cff9c11", whiteSpace: "nowrap" },
  empty: { marginTop: 24, padding: 24, borderRadius: 18, border: "1px dashed #2cff9c22", textAlign: "center", opacity: 0.7, fontSize: 13 },
};
