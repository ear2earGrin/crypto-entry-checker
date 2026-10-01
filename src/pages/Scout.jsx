import { useEffect, useState, Fragment } from "react";

/**
 * SCOUT — narrative discovery dashboard. Reads the snapshot the Mac mini's
 * scout job writes (data/scout/latest.json, served by the dev server at
 * /scout-data/latest.json). Nothing here fetches markets itself; the job does
 * the work hourly so the page opens instantly and shows the same numbers the
 * phone alerts were based on.
 *
 * Visual language follows the Narrative Scout concept page: slate panels,
 * amber accent, IBM Plex type, heatmap cells for relative strength.
 */

const DATA_URL = "/scout-data/latest.json";

const pct = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%`);
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

// Heatmap shade for a BTC-relative return.
const heat = (x) => (x === null || x === undefined || !Number.isFinite(x) ? "z" : x >= 10 ? "p2" : x > 1 ? "p1" : x >= -1 ? "z" : x > -10 ? "n1" : "n2");
const signClass = (x) => (x === null || x === undefined || !Number.isFinite(x) ? "" : x > 0 ? "up" : x < 0 ? "down" : "");
const STAGE_CLASS = { ACCELERATING: "s-acc", EMERGING: "s-em", MAINSTREAM: "s-main", EXHAUSTING: "s-exh", COLD: "s-cold", UNKNOWN: "s-cold" };
const STAGE_LABEL = { ACCELERATING: "Accelerating", EMERGING: "Emerging", MAINSTREAM: "Mainstream", EXHAUSTING: "Exhausting", COLD: "Cold", UNKNOWN: "Unknown" };

function Bar({ value, invert = false }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const good = invert ? 100 - v : v;
  const color = good >= 70 ? "var(--up)" : good >= 45 ? "var(--accent)" : "var(--down)";
  return (
    <span className="bar-wrap">
      <span className="bar"><i style={{ width: `${v}%`, background: color }} /></span>
      <span className="mono">{value ?? "–"}</span>
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
      <div className="ns">
        <style>{CSS}</style>
        <div className="wrap">
          <Header onRefresh={load} loading={loading} />
          <section className="panel">
            {loading ? <p className="muted">Loading the latest scan…</p> : (
              <>
                <h3>No Scout data yet{error && error !== "no-data" ? ` (${error})` : ""}</h3>
                <p className="muted">The Scout runs on the Mac mini and this page reads what it writes. In Terminal, in the project folder:</p>
                <pre className="pre">{`git pull\nnpm install\nnode scripts/scout.mjs        # first scan now (takes ~1–2 minutes)\nnode scripts/scout-install.mjs # then run it every hour automatically`}</pre>
                <p className="muted">On pm-brief.com this tab stays empty: the Scout's data lives on your Mac. Use http://localhost:5173/#/scout.</p>
              </>
            )}
          </section>
        </div>
      </div>
    );
  }

  const { book, gauge, funnel, btcRegime } = data;
  const bull = btcRegime?.state === "LONG_OK";
  const news = (data.news || []).filter((n) => grades[n.grade]);
  const cfg = data.bookConfig || {};

  return (
    <div className="ns">
      <style>{CSS}</style>
      <div className="wrap">
        <Header onRefresh={load} loading={loading} data={data} />

        {data.selftest && <div className="banner warn"><b>Selftest data.</b> Synthetic coins and prices. Run node scripts/scout.mjs on the Mac for the real scan.</div>}
        {data.scanError && (
          <div className="banner bad">
            <b>Market scan failed {ago(data.scanError.at)}.</b> CoinGecko: {data.scanError.coingecko?.ok ? "ok" : data.scanError.coingecko?.error || "not reached"} · Binance: {data.scanError.binance?.ok ? "ok" : data.scanError.binance?.error || "not reached"}.
            {data.scanDay ? ` Showing the last good scan (${data.scanDay}).` : " No scan has succeeded yet; news still updates."} It retries every hour.
          </div>
        )}
        {!bull && !data.scanError && (
          <div className="banner bad"><b>BTC regime is {btcRegime?.state ?? "unknown"}.</b> The Scout keeps watching but opens no new test positions until BTC's weekly regime is bullish.</div>
        )}

        <section className="rule" aria-label="The operating rule">
          <div><span className="eyebrow">Narrative decides</span><b>what to watch</b><span className="muted">The Scout builds the watchlist</span></div>
          <div><span className="eyebrow">Price decides</span><b>when</b><span className="muted">The pick rule fires, or nothing happens</span></div>
          <div><span className="eyebrow">Risk decides</span><b>how much</b><span className="muted">{usd(cfg.testAmount)} test per pick, stop set at entry</span></div>
        </section>

        <div className="grid2">
          <section className="panel">
            <div className="panel-head"><h2>Narrative rotation board</h2><span className="chip live">live</span></div>
            <p className="muted small">Each row is an equal-weight basket. Cells show performance relative to BTC. Breadth is the share of the basket beating BTC over 30 days.</p>
            <div className="scroll">
              <table>
                <thead><tr><th>Narrative</th><th>7d vs BTC</th><th>30d</th><th>200d</th><th>Breadth</th><th>Heat</th><th>Stage</th></tr></thead>
                <tbody>
                  {(data.narratives || []).map((b) => (
                    <tr key={b.key}>
                      <td>
                        {b.name}
                        {b.leader && <div className="tiny muted">Leader {b.leader.symbol} <span className={signClass(b.leader.rs7)}>{pct(b.leader.rs7, 0)}</span> 7d</div>}
                        {b.singleCoinEvent && <div className="tiny warn-text">one coin carrying it</div>}
                        {b.missing?.length > 0 && <div className="tiny muted">{b.missing.length} coin{b.missing.length > 1 ? "s" : ""} outside top 1,000</div>}
                      </td>
                      <td className={`heat ${heat(b.rs7)}`}>{pct(b.rs7, 0)}</td>
                      <td className={`heat ${heat(b.rs30)}`}>{pct(b.rs30, 0)}</td>
                      <td className={`heat ${heat(b.rs200)}`}>{pct(b.rs200, 0)}</td>
                      <td className="mono">{b.breadth30 === null || b.breadth30 === undefined ? "–" : `${b.breadth30.toFixed(0)}%`}</td>
                      <td><Bar value={b.heat} /></td>
                      <td><span className={`stage ${STAGE_CLASS[b.stage] || "s-cold"}`}>{STAGE_LABEL[b.stage] || b.stage}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.categories?.length > 0 && (
              <div className="cats">
                <span className="muted">Hottest CoinGecko categories, 24h:</span>
                {data.categories.slice(0, 8).map((c) => <span key={c.id} className="tag">{c.name} <b className={signClass(c.change24h)}>{pct(c.change24h)}</b></span>)}
              </div>
            )}
          </section>

          <div className="stack">
            <section className="panel">
              <div className="panel-head"><h3>BTC regime</h3><span className={`chip ${bull ? "live" : "bad"}`}>{bull ? "bull" : (btcRegime?.state || "unknown").toLowerCase()}</span></div>
              <p className="muted small">
                {btcRegime?.close ? <>Weekly close <b className="ink mono">{Math.round(btcRegime.close).toLocaleString("en-US")}</b> vs 50-week average <b className="ink mono">{Math.round(btcRegime.sma).toLocaleString("en-US")}</b>. </> : null}
                The master switch: new picks only while BTC is bullish.
              </p>
            </section>
            <section className="panel">
              <div className="panel-head"><h3>Alt-season gauge</h3><span className="chip">{gauge?.label?.toLowerCase() || "–"}</span></div>
              <div className="gauge" role="img" aria-label={`Gauge reading ${gauge?.score ?? "unknown"} of 100`}>
                <div className="track">{gauge?.score !== null && gauge?.score !== undefined && <span className="needle" style={{ left: `${gauge.score}%` }} />}</div>
                <div className="ends"><span>BTC leading</span><span className="mono ink">{gauge?.score ?? "–"}</span><span>Alts leading</span></div>
              </div>
              <p className="muted small">
                {gauge?.share30 !== null && gauge?.share30 !== undefined ? `${gauge.share30.toFixed(0)}% of the top ${gauge.sample} beat BTC over 30 days, ${gauge.share200?.toFixed(0)}% over 200 days. ` : ""}
                Alt season is when 75%+ do.
              </p>
            </section>
            <section className="panel">
              <div className="panel-head"><h3>Today's funnel</h3><span className="chip">{data.scanDay || "–"}</span></div>
              <div className="funnel">
                {[
                  [funnel?.universe, "Coins scanned"],
                  [funnel?.gated, "Liquid and on Binance"],
                  [funnel?.watchlist, "Passed all vetoes → watchlist"],
                  [funnel?.eligible, "Met the pick rule"],
                  [funnel?.picked, "Picked today → test buy"],
                ].map(([n, label]) => <div key={label}><span className="n mono">{n ?? "–"}</span><span className="f">{label}</span></div>)}
              </div>
            </section>
          </div>
        </div>

        <section className="panel">
          <div className="panel-head"><h2>Test book</h2><span className="chip">paper · {usd(cfg.startCash)}</span></div>
          <div className="tiles">
            <div className="tile"><span className="l">Equity</span><span className={`v ${Math.abs(book?.returnPct ?? 0) < 0.05 ? "" : signClass(book?.returnPct)}`}>{usd(book?.equity)}</span><span className="muted small">{pct(book?.returnPct)} since start</span></div>
            <div className="tile"><span className="l">Cash free</span><span className="v">{usd(book?.cash)}</span><span className="muted small">{book?.open?.length ?? 0} of {cfg.maxOpen ?? 5} slots used</span></div>
            <div className="tile"><span className="l">Closed trades</span><span className="v">{book?.stats?.trades ?? 0}</span><span className="muted small">win rate {book?.stats?.winRate ?? "–"}% · avg {book?.stats?.avgR ?? "–"}R</span></div>
            <div className="tile"><span className="l">Beat BTC</span><span className="v">{book?.stats?.beatBtcRate ?? "–"}{book?.stats?.beatBtcRate !== null && book?.stats?.beatBtcRate !== undefined ? "%" : ""}</span><span className="muted small">of closed trades, same days</span></div>
          </div>
          {book?.open?.length ? (
            <div className="scroll">
              <table>
                <thead><tr><th>Coin</th><th>Opened</th><th>Entry</th><th>Stop</th><th>Now</th><th>Result</th><th>BTC same days</th><th>vs BTC</th><th>Why picked</th></tr></thead>
                <tbody>
                  {book.open.map((p) => (
                    <tr key={p.id + p.entryTime}>
                      <td><b>{p.symbol}</b> {data.picksToday?.includes(p.id) && <span className="chip live">new</span>}</td>
                      <td className="mono">{p.entryDay}</td>
                      <td className="mono">{px(p.entry)}</td>
                      <td className="mono">{px(p.stop)}</td>
                      <td className="mono">{px(p.price)}</td>
                      <td className={`mono ${signClass(p.retPct)}`}>{pct(p.retPct)}</td>
                      <td className="mono">{pct(p.btcRetPct)}</td>
                      <td className={`mono ${signClass(p.vsBtcPct)}`}>{pct(p.vsBtcPct)}</td>
                      <td className="wrap-cell muted">{p.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No open test positions. {bull ? "A pick needs a coin that clears every rule below." : "Waiting for BTC's weekly regime to turn bullish."}</p>
          )}
          {book?.closed?.length > 0 && (
            <div className="scroll">
              <table>
                <thead><tr><th>Closed</th><th>Coin</th><th>Opened</th><th>Entry</th><th>Exit</th><th>Result</th><th>R</th><th>BTC same days</th><th>vs BTC</th><th>Exit reason</th></tr></thead>
                <tbody>
                  {[...book.closed].reverse().map((t) => (
                    <tr key={t.id + t.entryTime}>
                      <td className="mono">{ymd(t.exitTime)}</td>
                      <td><b>{t.symbol}</b></td>
                      <td className="mono">{t.entryDay}</td>
                      <td className="mono">{px(t.entry)}</td>
                      <td className="mono">{px(t.exit)}</td>
                      <td className={`mono ${signClass(t.retPct)}`}>{pct(t.retPct)} ({usd(t.pnl)})</td>
                      <td className="mono">{t.r ?? "–"}</td>
                      <td className="mono">{pct(t.btcRetPct)}</td>
                      <td className={`mono ${signClass(t.vsBtcPct)}`}>{pct(t.vsBtcPct)}</td>
                      <td>{t.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Watchlist</h2><span className="muted small">Click a coin to open its card</span></div>
          <div className="scroll">
            <table>
              <thead><tr><th>Coin</th><th>Narrative</th><th>Heat</th><th>Strength</th><th>Quality</th><th>Supply risk</th><th>7d vs BTC</th><th>30d vs BTC</th><th>Status</th></tr></thead>
              <tbody>
                {(data.watchlist || []).map((c) => (
                  <Fragment key={c.id}>
                    <tr className={`clickable ${open === c.id ? "open" : ""}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td><b>{c.symbol}</b> <span className="muted">{c.name}</span> {c.trending && <span className="chip info">trending</span>}</td>
                      <td className="muted">{c.narratives?.join(", ") || "–"}</td>
                      <td><Bar value={c.scores.heat} /></td>
                      <td><Bar value={c.scores.strength} /></td>
                      <td><Bar value={c.scores.quality} /></td>
                      <td><Bar value={c.scores.supplyRisk} invert /></td>
                      <td className={`heat ${heat(c.rs7)}`}>{pct(c.rs7, 0)}</td>
                      <td className={`heat ${heat(c.rs30)}`}>{pct(c.rs30, 0)}</td>
                      <td className="status">
                        {data.picksToday?.includes(c.id) ? <span className="tier on">Picked today</span>
                          : c.eligible ? <span className="up">Eligible{c.bookBlockers?.length ? ` · ${c.bookBlockers.join("; ")}` : ""}</span>
                          : <span className="muted">{c.pickFails?.join("; ")}</span>}
                      </td>
                    </tr>
                    {open === c.id && (
                      <tr className="card-row"><td colSpan={9}><CoinCard coin={c} explainer={data.explainers?.[c.id]} news={(data.news || []).filter((n) => n.coins?.includes(c.id))} picked={data.picksToday?.includes(c.id)} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Rejected by vetoes</h2>
            <button className="btn small" onClick={() => setShowRejects(!showRejects)}>{showRejects ? "Hide" : `Show ${data.rejects?.length ?? 0}`}</button>
          </div>
          {showRejects && (
            <div className="scroll">
              <table>
                <thead><tr><th>Coin</th><th>7d vs BTC</th><th>30d vs BTC</th><th>Why rejected</th></tr></thead>
                <tbody>
                  {(data.rejects || []).map((c) => (
                    <tr key={c.id}>
                      <td><b>{c.symbol}</b> <span className="muted">{c.name}</span></td>
                      <td className={`heat ${heat(c.rs7)}`}>{pct(c.rs7, 0)}</td>
                      <td className={`heat ${heat(c.rs30)}`}>{pct(c.rs30, 0)}</td>
                      <td className="wrap-cell down">{c.vetoes?.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>News radar</h2>
            <div className="filters">
              <span className="muted small">updated {ago(data.newsUpdatedAt)}</span>
              {["A", "B", "C"].map((g) => (
                <button key={g} className={`btn small ${grades[g] ? "" : "off"}`} onClick={() => setGrades({ ...grades, [g]: !grades[g] })}>{g}</button>
              ))}
            </div>
          </div>
          <div className="feed">
            {news.slice(0, 40).map((n) => (
              <div key={n.link} className="item">
                <span className={`grade g${n.grade}`}>{n.grade}</span>
                <div>
                  <a href={n.link} target="_blank" rel="noreferrer" className="headline">{n.title}</a>
                  <div className="tags">
                    <span className="muted small">{n.source} · {ago(n.published || n.firstSeen)}</span>
                    {(n.coins || []).map((id) => <span key={id} className="tag">{id}</span>)}
                    {(n.narratives || []).map((k) => <span key={k} className="tag">{k}</span>)}
                    {(n.types || []).map((t) => <span key={t} className="tag">{t}</span>)}
                  </div>
                </div>
              </div>
            ))}
            {!news.length && <p className="muted">No news items for the selected grades.</p>}
          </div>
        </section>

        <footer className="foot">
          <div className="health">
            <span className="muted">Sources</span>
            <Health label="CoinGecko" h={data.health?.coingecko} />
            <Health label="Binance" h={data.health?.binance} />
            <Health label="BTC regime" h={data.health?.btcRegime} />
            <Health label="Candles" h={data.health?.candles} />
            <span className={(data.newsHealth || []).some((h) => h.ok) ? "up" : "down"}>News {(data.newsHealth || []).filter((h) => h.ok).length}/{(data.newsHealth || []).length} feeds</span>
            <Health label="Claude explainers" h={data.health?.claude} />
            <span className="muted">X/Twitter not connected</span>
          </div>
          <p className="muted small"><b className="ink">Base rate:</b> most altcoins underperform BTC over a full cycle and many go to zero. The Scout raises the odds and screens out known blow-up patterns. Judge it by the journal after 3–6 months, not by single picks.</p>
        </footer>
      </div>
    </div>
  );
}

function Health({ label, h }) {
  if (!h) return <span className="muted">{label} –</span>;
  return <span className={h.ok ? "up" : "down"} title={h.error || h.note || ""}>{label} {h.ok ? "ok" : "off"}</span>;
}

function Header({ onRefresh, loading, data }) {
  return (
    <header className="top">
      <div className="top-text">
        <span className="eyebrow">Narrative discovery · companion to Crypto System v2.0</span>
        <h1>Narrative Scout</h1>
        <p className="muted">Finds the narratives money is rotating into, explains each coin, measures its supply and liquidity risk, and tests the best pick with paper money.</p>
        {data && <p className="muted small">Last scan {data.scanDay ?? "–"} ({ago(data.generatedAt)}) · news {ago(data.newsUpdatedAt)} · rescans daily after the UTC close, news hourly</p>}
      </div>
      <button className="btn" onClick={onRefresh} disabled={loading}>{loading ? "Loading…" : "Reload"}</button>
    </header>
  );
}

function CoinCard({ coin, explainer, news, picked }) {
  const t = coin.tech;
  const tier = picked ? "Picked" : coin.eligible ? "Watchlist · eligible" : coin.vetoes?.length ? "Reject" : "Watchlist";
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Coin deep-dive card</span>
          <div className="ticker-line"><span className="ticker">{coin.symbol}</span><span className="muted">{coin.name}{coin.narratives?.length ? ` · ${coin.narratives.join(", ")}` : ""}</span></div>
        </div>
        <div className="tiers">
          {["Radar", "Watchlist", "Reject"].map((x) => <span key={x} className={`tier ${tier.startsWith(x) || (x === "Watchlist" && tier === "Picked") ? "on" : ""}`}>{x === "Watchlist" ? tier.startsWith("Reject") ? "Watchlist" : tier : x}</span>)}
        </div>
      </div>

      {!coin.eligible && coin.pickFails?.length > 0 && <div className="flag"><b>NOT PICKED</b><span>{coin.pickFails.join("; ")}</span></div>}

      <div className="scores">
        <div className="score"><span className="l">Narrative heat</span><span className="v mono">{coin.scores.heat ?? "–"}</span></div>
        <div className="score"><span className="l">Relative strength</span><span className="v mono">{coin.scores.strength ?? "–"}</span></div>
        <div className="score"><span className="l">Quality</span><span className="v mono">{coin.scores.quality ?? "–"}</span></div>
        <div className="score"><span className="l">Supply risk (lower is better)</span><span className="v mono">{coin.scores.supplyRisk ?? "–"}</span></div>
      </div>

      <div className="sections">
        <div className="sec">
          <div className="panel-head"><h3>What it is</h3><span className={`chip ${explainer?.ai ? "info" : ""}`}>{explainer?.ai ? "Claude" : "project description"}</span></div>
          <p className="prose">{explainer?.text || "No description fetched yet. Explainers are made for new picks and the top five of the watchlist."}</p>
          <div className="links">
            {explainer?.homepage && <a href={explainer.homepage} target="_blank" rel="noreferrer">Homepage</a>}
            {explainer?.whitepaper && <a href={explainer.whitepaper} target="_blank" rel="noreferrer">Whitepaper</a>}
            <a href={`https://www.coingecko.com/en/coins/${coin.id}`} target="_blank" rel="noreferrer">CoinGecko</a>
            {explainer?.categories?.length ? <span className="muted">Categories: {explainer.categories.slice(0, 6).join(", ")}</span> : null}
          </div>
        </div>
        <div className="sec">
          <div className="panel-head"><h3>Token economics</h3></div>
          <dl>
            <dt>Market cap</dt><dd>{usd(coin.mcap)}</dd>
            <dt>Fully diluted value</dt><dd>{usd(coin.fdv)}</dd>
            <dt>FDV ÷ market cap</dt><dd>{coin.fdvToMcap ? `${coin.fdvToMcap.toFixed(2)}×` : "–"}</dd>
            <dt>Circulating share of supply</dt><dd>{coin.float !== null && coin.float !== undefined ? `${(coin.float * 100).toFixed(0)}%` : "–"}</dd>
            <dt>Unlock schedule</dt><dd className="muted">not connected yet</dd>
          </dl>
        </div>
        <div className="sec">
          <div className="panel-head"><h3>Liquidity and trend</h3></div>
          <dl>
            <dt>Price</dt><dd>{px(coin.price)}</dd>
            <dt>24h volume (share of market cap)</dt><dd>{usd(coin.vol)} ({coin.turnover ? `${(coin.turnover * 100).toFixed(1)}%` : "–"})</dd>
            <dt>Bid depth within 2%</dt><dd>{usd(coin.depthUsd)}</dd>
            <dt>Above 50-day average</dt><dd>{t ? (t.above50 ? "yes" : "no") : "–"}</dd>
            <dt>7-day move</dt><dd>{pct(t?.ret7)}</dd>
            <dt>Stretch above 20-day average</dt><dd>{t?.atrAboveSma20 !== null && t?.atrAboveSma20 !== undefined ? `${t.atrAboveSma20.toFixed(1)} ATR` : "–"}</dd>
          </dl>
        </div>
        <div className="sec">
          <div className="panel-head"><h3>vs BTC and news</h3></div>
          <dl>
            <dt>7 days</dt><dd className={signClass(coin.rs7)}>{pct(coin.rs7)}</dd>
            <dt>30 days</dt><dd className={signClass(coin.rs30)}>{pct(coin.rs30)}</dd>
            <dt>200 days</dt><dd className={signClass(coin.rs200)}>{pct(coin.rs200, 0)}</dd>
            <dt>News mentions, 7 days</dt><dd>{coin.newsCount ?? 0}</dd>
          </dl>
          {news.slice(0, 4).map((n) => (
            <div key={n.link} className="mini-news"><span className={`grade g${n.grade}`}>{n.grade}</span><a href={n.link} target="_blank" rel="noreferrer">{n.title}</a></div>
          ))}
        </div>
      </div>
    </div>
  );
}

const CSS = `
.ns {
  --bg: #0f151b; --panel: #161f28; --ink: #e3e9ee; --muted: #93a1ae; --line: #2a3643;
  --accent: #e89a45; --accent-soft: #3a2a17;
  --up: #6fd19c; --up-bg: #173327; --up-strong: #1f5a3e;
  --down: #f08b80; --down-bg: #3a1d1b; --down-strong: #6b2d27;
  --flat-bg: #1d2731; --warn: #e8c15a; --warn-bg: #3a3116; --info: #8fc8ff; --info-bg: #15283a;
  --display: "IBM Plex Sans Condensed", "Arial Narrow", sans-serif;
  --body: "IBM Plex Sans", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  flex: 1; width: 100%; box-sizing: border-box; background: var(--bg); color: var(--ink);
  font-family: var(--body); font-size: 14.5px; line-height: 1.5; color-scheme: dark;
}
.ns .wrap { max-width: 1180px; margin: 0 auto; padding-inline: 16px; padding-block: 26px 56px; display: grid; gap: 18px; }
.ns h1, .ns h2, .ns h3 { font-family: var(--display); margin: 0; letter-spacing: .01em; text-wrap: balance; color: var(--ink); }
.ns h1 { font-size: clamp(28px, 4.5vw, 40px); font-weight: 700; line-height: 1.1; }
.ns h2 { font-size: 21px; font-weight: 600; }
.ns h3 { font-size: 16px; font-weight: 600; }
.ns p { margin: 0; }
.ns .muted { color: var(--muted); }
.ns .ink { color: var(--ink); }
.ns .small { font-size: 12.5px; }
.ns .tiny { font-size: 11px; }
.ns .mono, .ns td.heat { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.ns .up { color: var(--up); } .ns .down { color: var(--down); } .ns .warn-text { color: var(--warn); }
.ns .eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
.ns a { color: var(--accent); text-decoration: none; }
.ns a:hover { text-decoration: underline; }
.ns a:focus-visible, .ns button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.ns .top { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; justify-content: space-between; }
.ns .top-text { display: grid; gap: 6px; max-width: 760px; min-width: 0; }
.ns .btn { font-family: var(--mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 8px 14px; cursor: pointer; }
.ns .btn:hover { border-color: var(--accent); }
.ns .btn.small { padding: 3px 10px; font-size: 11px; }
.ns .btn.off { opacity: .4; }
.ns .btn:disabled { opacity: .6; cursor: default; }

.ns .banner { border-radius: 6px; padding: 10px 14px; font-size: 13.5px; border: 1px solid; }
.ns .banner.warn { background: var(--warn-bg); border-color: var(--warn); color: var(--ink); }
.ns .banner.bad { background: var(--down-bg); border-color: var(--down); color: var(--ink); }

.ns .rule { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.ns .rule div { background: var(--panel); padding: 14px 16px; display: grid; gap: 2px; }
.ns .rule b { font-family: var(--display); font-size: 20px; font-weight: 600; }
@media (max-width: 640px) { .ns .rule { grid-template-columns: 1fr; } }

.ns .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; display: grid; gap: 12px; min-width: 0; align-content: start; }
.ns .panel-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
.ns .chip { font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.ns .chip.live { border-color: var(--up); color: var(--up); }
.ns .chip.bad { border-color: var(--down); color: var(--down); }
.ns .chip.info { border-color: var(--info); color: var(--info); }

.ns .grid2 { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr); gap: 18px; }
.ns .stack { display: grid; gap: 18px; align-content: start; min-width: 0; }
@media (max-width: 900px) { .ns .grid2 { grid-template-columns: 1fr; } }

.ns .scroll { overflow-x: auto; }
.ns table { border-collapse: separate; border-spacing: 0 2px; width: 100%; font-size: 13.5px; }
.ns th { font-family: var(--mono); font-weight: 500; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.ns td { padding: 7px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: middle; }
.ns td.heat { text-align: right; border-radius: 3px; border-bottom-color: transparent; }
.ns td.wrap-cell { white-space: normal; min-width: 220px; }
.ns td.status { white-space: normal; min-width: 170px; font-size: 12.5px; }
.ns .p2 { background: var(--up-strong); } .ns .p1 { background: var(--up-bg); } .ns .z { background: var(--flat-bg); }
.ns .n1 { background: var(--down-bg); } .ns .n2 { background: var(--down-strong); }
.ns tr.clickable { cursor: pointer; }
.ns tr.clickable:hover td:not(.heat), .ns tr.open td:not(.heat) { background: #1b2632; }
.ns tr.card-row td { padding: 0; white-space: normal; border-bottom: 0; }

.ns .stage { font-family: var(--mono); font-size: 11px; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
.ns .s-acc { background: var(--up-bg); color: var(--up); }
.ns .s-em { background: var(--info-bg); color: var(--info); }
.ns .s-main { background: var(--warn-bg); color: var(--warn); }
.ns .s-exh { background: var(--down-bg); color: var(--down); }
.ns .s-cold { background: var(--flat-bg); color: var(--muted); }

.ns .bar-wrap { display: inline-flex; align-items: center; gap: 7px; }
.ns .bar { height: 6px; width: 56px; background: var(--flat-bg); border-radius: 3px; display: inline-block; overflow: hidden; }
.ns .bar i { display: block; height: 100%; border-radius: 3px; }
.ns .bar-wrap .mono { min-width: 22px; text-align: right; font-size: 12.5px; }

.ns .cats { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 12.5px; }
.ns .tag { font-family: var(--mono); font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: 0 6px; }

.ns .gauge { display: grid; gap: 8px; }
.ns .track { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--down-strong), var(--flat-bg) 50%, var(--up-strong)); position: relative; }
.ns .needle { position: absolute; top: -5px; width: 3px; height: 22px; margin-left: -1px; background: var(--ink); border-radius: 2px; }
.ns .ends { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11px; color: var(--muted); }

.ns .funnel { display: grid; gap: 6px; }
.ns .funnel div { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 10px; align-items: center; }
.ns .funnel .n { text-align: right; font-weight: 500; font-size: 15px; }
.ns .funnel .f { background: var(--accent-soft); border-left: 3px solid var(--accent); padding: 5px 10px; font-size: 13px; border-radius: 0 4px 4px 0; }

.ns .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 760px) { .ns .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ns .tile { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; display: grid; gap: 2px; }
.ns .tile .l { font-size: 12px; color: var(--muted); }
.ns .tile .v { font-family: var(--mono); font-size: 21px; }

.ns .feed { display: grid; }
.ns .item { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.ns .item:last-child { border-bottom: 0; }
.ns .grade { font-family: var(--mono); font-weight: 500; font-size: 12px; text-align: center; padding: 3px 0; border-radius: 4px; align-self: start; min-width: 22px; }
.ns .gA { background: var(--up-bg); color: var(--up); } .ns .gB { background: var(--flat-bg); color: var(--ink); } .ns .gC { background: var(--down-bg); color: var(--down); }
.ns .headline { color: var(--ink); font-weight: 600; }
.ns .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; align-items: center; }
.ns .filters { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

.ns .card { background: #121a22; border-top: 2px solid var(--accent); padding: 16px; display: grid; gap: 14px; position: sticky; left: 0; box-sizing: border-box; width: min(1144px, calc(100vw - 32px)); }
.ns .card-head { display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: flex-end; justify-content: space-between; }
.ns .ticker-line { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.ns .ticker { font-family: var(--display); font-size: 34px; font-weight: 700; line-height: 1; }
.ns .tiers { display: flex; flex-wrap: wrap; gap: 6px; }
.ns .tier { font-family: var(--mono); font-size: 11.5px; padding: 3px 9px; border-radius: 4px; background: var(--flat-bg); color: var(--muted); }
.ns .tier.on { background: var(--warn-bg); color: var(--warn); font-weight: 500; }
.ns .flag { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 6px; background: var(--warn-bg); font-size: 13.5px; }
.ns .flag b { color: var(--warn); font-family: var(--mono); font-size: 12px; letter-spacing: .06em; white-space: nowrap; }
.ns .scores { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 640px) { .ns .scores { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ns .score { border: 1px solid var(--line); border-radius: 6px; padding: 10px; display: grid; gap: 4px; }
.ns .score .v { font-size: 22px; }
.ns .score .l { font-size: 12.5px; color: var(--muted); }
.ns .sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; }
.ns .sec { border-top: 2px solid var(--line); padding-top: 10px; display: grid; gap: 8px; min-width: 0; align-content: start; }
.ns .prose { font-size: 13.5px; white-space: pre-wrap; line-height: 1.55; }
.ns .links { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; }
.ns dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; margin: 0; font-size: 13px; }
.ns dt { color: var(--muted); }
.ns dd { margin: 0; font-family: var(--mono); text-align: right; }
.ns .mini-news { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; font-size: 12.5px; }
.ns .mini-news a { color: var(--ink); }

.ns .foot { display: grid; gap: 8px; font-size: 12.5px; }
.ns .health { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.ns .pre { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 12px; font-family: var(--mono); font-size: 12px; white-space: pre-wrap; margin: 0; }
`;
