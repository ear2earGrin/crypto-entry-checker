import { useEffect, useState, Fragment } from "react";

/**
 * SCOUT — narrative discovery dashboard. Reads the snapshot the Mac mini's
 * scout job writes (data/scout/latest.json, served by the dev server at
 * /scout-data/latest.json). Nothing here fetches markets itself; the job does
 * the work hourly so the page opens instantly and shows the same numbers the
 * phone alerts were based on.
 */

const DATA_URL = "/scout-data/latest.json";

const pct = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);
const usd = (x) => {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  if (Math.abs(x) >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (Math.abs(x) >= 1e3) return `$${(x / 1e3).toFixed(1)}k`;
  return `$${x.toFixed(2)}`;
};
const px = (x) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(4) : x.toPrecision(4));
const ago = (iso) => {
  if (!iso) return "–";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const ymd = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : "–");

const heatColor = (x) => (x === null || x === undefined ? "#6b7f76" : x >= 70 ? "#2cff9c" : x >= 50 ? "#b8f5d2" : x >= 30 ? "#c9b27a" : "#ff8f8f");
const rsColor = (x) => (x === null || x === undefined ? "#6b7f76" : x > 5 ? "#2cff9c" : x > 0 ? "#b8f5d2" : x > -5 ? "#e6c98f" : "#ff8f8f");
const STAGE_COLORS = {
  ACCELERATING: ["#0d3a25", "#7cffb1"],
  EMERGING: ["#10243a", "#8fc8ff"],
  MAINSTREAM: ["#3a3010", "#ffd76a"],
  EXHAUSTING: ["#3a1616", "#ff9b9b"],
  COLD: ["#1a1f1d", "#8a9a92"],
  UNKNOWN: ["#1a1f1d", "#8a9a92"],
};
const GRADE_COLORS = { A: ["#0d3a25", "#7cffb1"], B: ["#1a1f1d", "#c8d6cf"], C: ["#3a1616", "#ff9b9b"] };

function Chip({ text, colors }) {
  const [bg, fg] = colors || ["#1a1f1d", "#c8d6cf"];
  return <span style={{ alignSelf: "start", justifySelf: "start", padding: "2px 8px", borderRadius: 999, background: bg, color: fg, fontSize: 10, fontWeight: 800, letterSpacing: 1, whiteSpace: "nowrap" }}>{text}</span>;
}

function ScoreBar({ value, invert = false }) {
  const v = value ?? 0;
  const color = invert ? heatColor(100 - v) : heatColor(v);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 46, height: 6, background: "#12201a", borderRadius: 3, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", width: `${Math.max(0, Math.min(100, v))}%`, height: "100%", background: color }} />
      </span>
      <span style={{ color, minWidth: 22, textAlign: "right" }}>{value ?? "–"}</span>
    </span>
  );
}

export default function Scout() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [grades, setGrades] = useState({ A: true, B: true, C: false });
  const [showRejects, setShowRejects] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "no-data" : `HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (!data) {
    return (
      <div style={styles.page}>
        <Header onRefresh={load} loading={loading} />
        <div style={{ ...styles.empty, marginTop: 16, textAlign: "left", lineHeight: 1.7 }}>
          {loading ? "Loading the latest scan…" : (
            <>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>No Scout data yet{error && error !== "no-data" ? ` (${error})` : ""}.</div>
              The Scout runs on the Mac mini and this page reads what it writes. In Terminal, in the project folder:
              <pre style={styles.pre}>{`git pull\nnpm install\nnode scripts/scout.mjs        # first scan now (takes ~1–2 minutes)\nnode scripts/scout-install.mjs # then run it every hour automatically`}</pre>
              On pm-brief.com this tab stays empty: the Scout's data lives on your Mac, not on the website. Use http://localhost:5173/#/scout.
            </>
          )}
        </div>
      </div>
    );
  }

  const { book, gauge, funnel, btcRegime } = data;
  const news = (data.news || []).filter((n) => grades[n.grade]);
  const bull = btcRegime?.state === "LONG_OK";

  return (
    <div style={styles.page}>
      <Header onRefresh={load} loading={loading} data={data} />

      {data.selftest && (
        <div style={{ ...styles.banner, borderColor: "#ffd76a55", background: "#1f1a08", color: "#ffd76a" }}>
          SELFTEST DATA — synthetic coins and prices. Run node scripts/scout.mjs on the Mac for the real scan.
        </div>
      )}
      {!bull && (
        <div style={{ ...styles.banner, borderColor: "#ff8f8f55", background: "#1f0c0c", color: "#ffb3b3" }}>
          BTC regime is {btcRegime?.state ?? "unknown"} — the Scout keeps watching but opens no new test positions until BTC's weekly regime is bullish.
        </div>
      )}

      <div style={styles.statsRow}>
        <div style={styles.stat}>
          <div style={styles.statLabel}>BTC REGIME</div>
          <div style={{ ...styles.statValue, color: bull ? "#2cff9c" : "#ff8f8f" }}>{bull ? "BULL" : btcRegime?.state ?? "–"}</div>
          <div style={styles.statSub}>{btcRegime?.close ? `weekly ${Math.round(btcRegime.close).toLocaleString()} vs 50W ${Math.round(btcRegime.sma).toLocaleString()}` : "master switch for new picks"}</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>ALT-SEASON GAUGE</div>
          <div style={{ ...styles.statValue, color: heatColor(gauge?.score) }}>{gauge?.score ?? "–"}</div>
          <div style={styles.statSub}>{gauge?.label} · {gauge?.share30?.toFixed(0) ?? "–"}% of top {gauge?.sample} beat BTC (30d), {gauge?.share200?.toFixed(0) ?? "–"}% (200d)</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>TEST BOOK</div>
          <div style={{ ...styles.statValue, color: Math.abs(book?.returnPct ?? 0) < 0.05 ? "#d7ffe8" : book.returnPct > 0 ? "#2cff9c" : "#ff8f8f" }}>{usd(book?.equity)}</div>
          <div style={styles.statSub}>{pct(book?.returnPct)} on {usd(data.bookConfig?.startCash)} · {usd(data.bookConfig?.testAmount)} per pick</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>SCORECARD</div>
          <div style={styles.statValue}>{book?.stats?.trades ?? 0} closed</div>
          <div style={styles.statSub}>win {book?.stats?.winRate ?? "–"}% · beat BTC {book?.stats?.beatBtcRate ?? "–"}% · avg {book?.stats?.avgR ?? "–"}R</div>
        </div>
      </div>

      <div style={styles.funnel}>
        {[
          [funnel?.universe, "coins scanned"],
          [funnel?.gated, "liquid + on Binance"],
          [funnel?.watchlist, "passed vetoes"],
          [funnel?.eligible, "met pick rule"],
          [funnel?.picked, "picked today"],
        ].map(([n, label], i) => (
          <Fragment key={label}>
            {i > 0 && <span style={{ opacity: 0.4 }}>→</span>}
            <span><b style={{ color: "#2cff9c" }}>{n ?? "–"}</b> <span style={{ opacity: 0.7 }}>{label}</span></span>
          </Fragment>
        ))}
      </div>

      <div style={styles.sectionTitle}>TEST POSITIONS</div>
      {book?.open?.length ? (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead><tr>{["Coin", "Opened", "Entry", "Stop", "Now", "Result", "BTC same days", "vs BTC", "Why picked"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {book.open.map((p) => (
                <tr key={p.id + p.entryTime}>
                  <td style={{ ...styles.td, fontWeight: 800 }}>{p.symbol} {data.picksToday?.includes(p.id) && <span style={styles.newTag}>NEW</span>}</td>
                  <td style={styles.td}>{p.entryDay}</td>
                  <td style={styles.td}>{px(p.entry)}</td>
                  <td style={styles.td}>{px(p.stop)}</td>
                  <td style={styles.td}>{px(p.price)}</td>
                  <td style={{ ...styles.td, color: rsColor(p.retPct) }}>{pct(p.retPct)}</td>
                  <td style={styles.td}>{pct(p.btcRetPct)}</td>
                  <td style={{ ...styles.td, color: rsColor(p.vsBtcPct) }}>{pct(p.vsBtcPct)}</td>
                  <td style={{ ...styles.td, whiteSpace: "normal", minWidth: 240, opacity: 0.8 }}>{p.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={styles.empty}>No open test positions. {bull ? "A pick needs a coin that clears every rule below." : "Waiting for BTC's weekly regime to turn bullish."}</div>
      )}

      {book?.closed?.length > 0 && (
        <>
          <div style={styles.sectionTitle}>CLOSED TEST TRADES</div>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead><tr>{["Coin", "Opened", "Closed", "Entry", "Exit", "Result", "R", "BTC same days", "vs BTC", "Exit reason"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
              <tbody>
                {[...book.closed].reverse().map((t) => (
                  <tr key={t.id + t.entryTime}>
                    <td style={{ ...styles.td, fontWeight: 800 }}>{t.symbol}</td>
                    <td style={styles.td}>{t.entryDay}</td>
                    <td style={styles.td}>{ymd(t.exitTime)}</td>
                    <td style={styles.td}>{px(t.entry)}</td>
                    <td style={styles.td}>{px(t.exit)}</td>
                    <td style={{ ...styles.td, color: rsColor(t.retPct) }}>{pct(t.retPct)} ({usd(t.pnl)})</td>
                    <td style={styles.td}>{t.r ?? "–"}</td>
                    <td style={styles.td}>{pct(t.btcRetPct)}</td>
                    <td style={{ ...styles.td, color: rsColor(t.vsBtcPct) }}>{pct(t.vsBtcPct)}</td>
                    <td style={styles.td}>{t.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={styles.sectionTitle}>NARRATIVE ROTATION (performance vs BTC)</div>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead><tr>{["Narrative", "7d", "30d", "200d", "Breadth", "Heat", "Stage", "Leader (7d)", "Note"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {data.narratives.map((b) => (
              <tr key={b.key}>
                <td style={{ ...styles.td, fontWeight: 800 }}>{b.name}</td>
                <td style={{ ...styles.td, color: rsColor(b.rs7) }}>{pct(b.rs7)}</td>
                <td style={{ ...styles.td, color: rsColor(b.rs30) }}>{pct(b.rs30)}</td>
                <td style={{ ...styles.td, color: rsColor(b.rs200) }}>{pct(b.rs200, 0)}</td>
                <td style={styles.td}>{b.breadth30 === null ? "–" : `${b.breadth30.toFixed(0)}%`}</td>
                <td style={styles.td}><ScoreBar value={b.heat} /></td>
                <td style={styles.td}><Chip text={b.stage} colors={STAGE_COLORS[b.stage]} /></td>
                <td style={styles.td}>{b.leader ? `${b.leader.symbol} ${pct(b.leader.rs7)}` : "–"}</td>
                <td style={{ ...styles.td, opacity: 0.75 }}>
                  {b.singleCoinEvent ? "one coin carrying the basket" : ""}
                  {b.missing?.length ? ` ${b.missing.length} id(s) not found` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.categories?.length > 0 && (
        <div style={{ ...styles.funnel, flexWrap: "wrap", fontSize: 11 }}>
          <span style={{ opacity: 0.7 }}>Hottest CoinGecko categories (24h market cap):</span>
          {data.categories.slice(0, 8).map((c) => (
            <span key={c.id} style={{ color: rsColor(c.change24h) }}>{c.name} {pct(c.change24h)}</span>
          ))}
        </div>
      )}

      <div style={styles.sectionTitle}>WATCHLIST — click a coin for its card</div>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead><tr>{["Coin", "Narrative", "Heat", "Strength", "Quality", "Supply risk", "7d vs BTC", "30d vs BTC", "FDV/MC", "Float", "Volume", "Status"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {data.watchlist.map((c) => (
              <Fragment key={c.id}>
                <tr onClick={() => setOpen(open === c.id ? null : c.id)} style={{ cursor: "pointer", background: open === c.id ? "#0b1a14" : undefined }}>
                  <td style={{ ...styles.td, fontWeight: 800 }}>
                    {c.symbol} <span style={{ opacity: 0.6, fontWeight: 400 }}>{c.name}</span>
                    {c.trending && <span style={{ ...styles.newTag, background: "#10243a", color: "#8fc8ff" }}>TRENDING</span>}
                  </td>
                  <td style={{ ...styles.td, opacity: 0.8 }}>{c.narratives?.join(", ") || "–"}</td>
                  <td style={styles.td}><ScoreBar value={c.scores.heat} /></td>
                  <td style={styles.td}><ScoreBar value={c.scores.strength} /></td>
                  <td style={styles.td}><ScoreBar value={c.scores.quality} /></td>
                  <td style={styles.td}><ScoreBar value={c.scores.supplyRisk} invert /></td>
                  <td style={{ ...styles.td, color: rsColor(c.rs7) }}>{pct(c.rs7)}</td>
                  <td style={{ ...styles.td, color: rsColor(c.rs30) }}>{pct(c.rs30)}</td>
                  <td style={styles.td}>{c.fdvToMcap ? `${c.fdvToMcap.toFixed(2)}×` : "–"}</td>
                  <td style={styles.td}>{c.float !== null ? `${(c.float * 100).toFixed(0)}%` : "–"}</td>
                  <td style={styles.td}>{usd(c.vol)}</td>
                  <td style={{ ...styles.td, whiteSpace: "normal", minWidth: 180 }}>
                    {data.picksToday?.includes(c.id) ? <Chip text="PICKED TODAY" colors={["#0d3a25", "#7cffb1"]} />
                      : c.eligible ? <span style={{ color: "#2cff9c" }}>eligible{c.bookBlockers?.length ? ` · ${c.bookBlockers.join("; ")}` : ""}</span>
                      : <span style={{ opacity: 0.7 }}>{c.pickFails?.join("; ")}</span>}
                  </td>
                </tr>
                {open === c.id && (
                  <tr><td colSpan={12} style={{ padding: 0 }}><CoinCard coin={c} explainer={data.explainers?.[c.id]} news={(data.news || []).filter((n) => n.coins?.includes(c.id))} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.sectionTitle}>
        REJECTED BY VETOES ({data.rejects?.length ?? 0} of the shortlist)
        <button style={{ ...styles.smallBtn, marginLeft: 10 }} onClick={() => setShowRejects(!showRejects)}>{showRejects ? "hide" : "show"}</button>
      </div>
      {showRejects && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead><tr>{["Coin", "7d vs BTC", "30d vs BTC", "Why rejected"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.rejects.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...styles.td, fontWeight: 800 }}>{c.symbol} <span style={{ opacity: 0.6, fontWeight: 400 }}>{c.name}</span></td>
                  <td style={{ ...styles.td, color: rsColor(c.rs7) }}>{pct(c.rs7)}</td>
                  <td style={{ ...styles.td, color: rsColor(c.rs30) }}>{pct(c.rs30)}</td>
                  <td style={{ ...styles.td, whiteSpace: "normal", color: "#ffb3b3" }}>{c.vetoes?.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={styles.sectionTitle}>
        NEWS RADAR · updated {ago(data.newsUpdatedAt)}
        {["A", "B", "C"].map((g) => (
          <button key={g} onClick={() => setGrades({ ...grades, [g]: !grades[g] })}
            style={{ ...styles.smallBtn, marginLeft: 8, opacity: grades[g] ? 1 : 0.4 }}>{g}</button>
        ))}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {news.slice(0, 40).map((n) => (
          <div key={n.link} style={{ ...styles.event, borderColor: "#2cff9c18", display: "grid", gridTemplateColumns: "28px 1fr", gap: 10 }}>
            <Chip text={n.grade} colors={GRADE_COLORS[n.grade]} />
            <div>
              <a href={n.link} target="_blank" rel="noreferrer" style={{ color: "#d7ffe8", fontWeight: 700, textDecoration: "none" }}>{n.title}</a>
              <div style={{ opacity: 0.65, fontSize: 11, marginTop: 3 }}>
                {n.source} · {ago(n.published || n.firstSeen)}
                {n.coins?.length ? ` · ${n.coins.join(", ")}` : ""}
                {n.narratives?.length ? ` · ${n.narratives.join(", ")}` : ""}
                {n.types?.length ? ` · ${n.types.join(", ")}` : ""}
              </div>
            </div>
          </div>
        ))}
        {!news.length && <div style={styles.empty}>No news items for the selected grades.</div>}
      </div>

      <div style={{ ...styles.funnel, marginTop: 18, fontSize: 11, flexWrap: "wrap" }}>
        <span style={{ opacity: 0.7 }}>Sources:</span>
        <Health label="CoinGecko" h={data.health?.coingecko} />
        <Health label="Binance" h={data.health?.binance} />
        <Health label="BTC regime" h={data.health?.btcRegime} />
        <Health label="Candles" h={data.health?.candles} />
        <span style={{ color: (data.newsHealth || []).some((h) => h.ok) ? "#7cffb1" : "#ff8f8f" }}>
          News {(data.newsHealth || []).filter((h) => h.ok).length}/{(data.newsHealth || []).length} feeds
        </span>
        <Health label="Claude explainers" h={data.health?.claude} />
        <span style={{ opacity: 0.55 }}>X/Twitter: not connected (paid API)</span>
      </div>
    </div>
  );
}

function Health({ label, h }) {
  if (!h) return <span style={{ opacity: 0.5 }}>{label}: –</span>;
  return <span style={{ color: h.ok ? "#7cffb1" : "#ff8f8f" }} title={h.error || h.note || ""}>{label} {h.ok ? "ok" : "off"}</span>;
}

function Header({ onRefresh, loading, data }) {
  return (
    <div style={styles.header}>
      <div>
        <h1 style={styles.title}>SCOUT</h1>
        <div style={styles.subtitle}>
          Narrative discovery with a $10k paper test book. Narrative decides what to watch, price decides when, risk decides how much.
          The Mac mini rescans once a day after the UTC close and checks news every hour.
          {data && <><br />Last scan {data.scanDay} ({ago(data.generatedAt)}) · news {ago(data.newsUpdatedAt)}</>}
        </div>
      </div>
      <button style={styles.btn} onClick={onRefresh} disabled={loading}>{loading ? "LOADING…" : "RELOAD"}</button>
    </div>
  );
}

function CoinCard({ coin, explainer, news }) {
  const t = coin.tech;
  return (
    <div style={{ position: "sticky", left: 0, boxSizing: "border-box", width: "min(1150px, calc(100vw - 30px))", padding: 14, background: "#07110d", borderTop: "1px solid #2cff9c22", display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      <div style={{ minWidth: 0 }}>
        <div style={styles.cardTitle}>WHAT IT IS {explainer?.ai ? <Chip text="CLAUDE" colors={["#10243a", "#8fc8ff"]} /> : <Chip text="PROJECT DESCRIPTION" />}</div>
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 12, opacity: 0.9 }}>
          {explainer?.text || "No description fetched yet — explainers are generated for new picks and the top five of the watchlist."}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.75, display: "flex", gap: 12, flexWrap: "wrap" }}>
          {explainer?.homepage && <a style={styles.link} href={explainer.homepage} target="_blank" rel="noreferrer">homepage</a>}
          {explainer?.whitepaper && <a style={styles.link} href={explainer.whitepaper} target="_blank" rel="noreferrer">whitepaper</a>}
          <a style={styles.link} href={`https://www.coingecko.com/en/coins/${coin.id}`} target="_blank" rel="noreferrer">CoinGecko</a>
          {explainer?.categories?.length ? <span>categories: {explainer.categories.slice(0, 6).join(", ")}</span> : null}
        </div>
        {news.length > 0 && (
          <>
            <div style={{ ...styles.cardTitle, marginTop: 12 }}>RECENT NEWS</div>
            {news.slice(0, 5).map((n) => (
              <div key={n.link} style={{ fontSize: 12, marginBottom: 4 }}>
                <Chip text={n.grade} colors={GRADE_COLORS[n.grade]} />{" "}
                <a style={{ ...styles.link, color: "#d7ffe8" }} href={n.link} target="_blank" rel="noreferrer">{n.title}</a>
              </div>
            ))}
          </>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={styles.cardTitle}>NUMBERS</div>
        <dl style={styles.dl}>
          <dt style={{ opacity: 0.7 }}>Price</dt><dd style={{ margin: 0, textAlign: "right" }}>{px(coin.price)}</dd>
          <dt style={{ opacity: 0.7 }}>Market cap / FDV</dt><dd style={{ margin: 0, textAlign: "right" }}>{usd(coin.mcap)} / {usd(coin.fdv)}</dd>
          <dt style={{ opacity: 0.7 }}>Circulating share</dt><dd style={{ margin: 0, textAlign: "right" }}>{coin.float !== null ? `${(coin.float * 100).toFixed(0)}%` : "–"}</dd>
          <dt style={{ opacity: 0.7 }}>24h volume (turnover)</dt><dd style={{ margin: 0, textAlign: "right" }}>{usd(coin.vol)} ({coin.turnover ? `${(coin.turnover * 100).toFixed(1)}%` : "–"})</dd>
          <dt style={{ opacity: 0.7 }}>Bid depth within 2%</dt><dd style={{ margin: 0, textAlign: "right" }}>{usd(coin.depthUsd)}</dd>
          <dt style={{ opacity: 0.7 }}>vs BTC 7d / 30d / 200d</dt><dd style={{ margin: 0, textAlign: "right" }}>{pct(coin.rs7)} / {pct(coin.rs30)} / {pct(coin.rs200, 0)}</dd>
          <dt style={{ opacity: 0.7 }}>Above 50-day average</dt><dd style={{ margin: 0, textAlign: "right" }}>{t ? (t.above50 ? "yes" : "no") : "–"}</dd>
          <dt style={{ opacity: 0.7 }}>7-day move</dt><dd style={{ margin: 0, textAlign: "right" }}>{pct(t?.ret7)}</dd>
          <dt style={{ opacity: 0.7 }}>Stretch above 20-day avg</dt><dd style={{ margin: 0, textAlign: "right" }}>{t?.atrAboveSma20 !== null && t?.atrAboveSma20 !== undefined ? `${t.atrAboveSma20.toFixed(1)} ATR` : "–"}</dd>
          <dt style={{ opacity: 0.7 }}>News mentions (7d)</dt><dd style={{ margin: 0, textAlign: "right" }}>{coin.newsCount ?? 0}</dd>
        </dl>
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8, lineHeight: 1.5 }}>
          Unlock schedules and holder concentration aren't connected yet. FDV/MC and circulating share stand in for supply risk.
        </div>
      </div>
    </div>
  );
}

const styles = {
  // Full-bleed dark ground so the page reads the same when macOS is in light mode.
  page: { flex: 1, boxSizing: "border-box", width: "100%", background: "#040806", padding: "26px max(14px, calc((100% - 1180px) / 2)) 40px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", color: "#d7ffe8" },
  header: {
    border: "1px solid #2cff9c33",
    background: "radial-gradient(1200px 280px at 10% 0%, #1cff8a22, transparent), linear-gradient(180deg, #07110e, #050807)",
    padding: 16, borderRadius: 18, boxShadow: "0 0 0 1px #0d2a1d inset, 0 30px 80px #00000088",
    display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center",
  },
  title: { margin: 0, letterSpacing: 3, fontWeight: 900, fontSize: 22 },
  subtitle: { marginTop: 6, opacity: 0.78, lineHeight: 1.4, fontSize: 12, maxWidth: 820 },
  btn: {
    padding: "10px 14px", borderRadius: 14, border: "1px solid #2cff9c33",
    background: "linear-gradient(180deg, #0b1712, #070b09)", color: "#d7ffe8",
    cursor: "pointer", letterSpacing: 1.4, fontWeight: 800, boxShadow: "0 10px 25px #00000088",
  },
  smallBtn: { padding: "2px 9px", borderRadius: 8, border: "1px solid #2cff9c33", background: "#08120e", color: "#d7ffe8", cursor: "pointer", fontSize: 10, fontWeight: 800, fontFamily: "inherit" },
  banner: { marginTop: 12, padding: 12, borderRadius: 14, border: "1px solid", fontSize: 13, fontWeight: 700 },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 14 },
  stat: { padding: 12, borderRadius: 14, border: "1px solid #2cff9c22", background: "#06120e" },
  statLabel: { fontSize: 10, letterSpacing: 2, opacity: 0.7, fontWeight: 700 },
  statValue: { fontSize: 20, fontWeight: 900, marginTop: 4 },
  statSub: { fontSize: 11, opacity: 0.7, marginTop: 4, lineHeight: 1.4 },
  funnel: { display: "flex", gap: 10, alignItems: "center", marginTop: 12, padding: "9px 12px", borderRadius: 12, border: "1px solid #2cff9c18", background: "#050d0a", fontSize: 12, flexWrap: "wrap" },
  sectionTitle: { marginTop: 18, marginBottom: 8, fontSize: 12, letterSpacing: 2, opacity: 0.85, fontWeight: 700, display: "flex", alignItems: "center", flexWrap: "wrap" },
  tableWrap: { borderRadius: 14, border: "1px solid #2cff9c22", overflow: "auto", background: "#06120e" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left", padding: "9px 12px", borderBottom: "1px solid #2cff9c22", background: "#08120e", fontSize: 11, letterSpacing: 1, opacity: 0.9, whiteSpace: "nowrap" },
  td: { padding: "8px 12px", borderBottom: "1px solid #2cff9c11", whiteSpace: "nowrap" },
  event: { padding: "9px 12px", borderRadius: 10, border: "1px solid", fontSize: 12, lineHeight: 1.5 },
  newTag: { marginLeft: 8, padding: "1px 7px", borderRadius: 999, background: "#0d3a25", color: "#7cffb1", fontSize: 9, fontWeight: 900, letterSpacing: 1 },
  empty: { padding: 20, borderRadius: 14, border: "1px dashed #2cff9c22", textAlign: "center", opacity: 0.75, fontSize: 13 },
  pre: { background: "#050807", border: "1px solid #2cff9c22", borderRadius: 10, padding: 12, margin: "10px 0", fontSize: 12, whiteSpace: "pre-wrap" },
  cardTitle: { fontSize: 10, letterSpacing: 2, fontWeight: 800, opacity: 0.75, marginBottom: 6, display: "flex", gap: 8, alignItems: "center" },
  dl: { display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", margin: 0, fontSize: 12 },
  link: { color: "#7cffb1" },
};
