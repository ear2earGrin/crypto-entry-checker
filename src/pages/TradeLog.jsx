import { useMemo, useState } from "react";
import {
  loadTrades, addTrade, closeTrade, updateTrade, deleteTrade,
  exportTradesJSON, importTrades,
  tradeToObsidianMarkdown, obsidianFilename,
} from "../data/tradeLog.js";
import { T, TONE, ui } from "../ui/theme.js";
import { Page, PageHeader, Tile } from "../ui/Page.jsx";

const ASSETS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];

function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}
function ymd(unix) {
  if (!unix) return "-";
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

// Two lanes, two scorecards. "system" = mechanical v2.0 signals followed to the
// dot; "discretionary" = Market Cipher / judgment trades. Legacy values map:
// scanner->system, manual->discretionary.
function laneOf(t) {
  const s = (t.systemSource || "").toLowerCase();
  return s === "manual" || s === "discretionary" ? "DISCRETIONARY" : "SYSTEM";
}

function laneStats(trades) {
  if (!trades.length) return { count: 0, wins: 0, losses: 0, pnl: 0, avgR: 0 };
  let pnl = 0, wins = 0, losses = 0, rSum = 0;
  for (const t of trades) {
    const p = t.exit ? (t.direction === "LONG" ? 1 : -1) * t.entry.qty * (t.exit.price - t.entry.price) : 0;
    pnl += p;
    if (p > 0) wins++; else losses++;
    if (t.entry?.riskDollar) rSum += p / t.entry.riskDollar;
  }
  return { count: trades.length, wins, losses, pnl, avgR: rSum / trades.length };
}

export default function TradeLog() {
  const [trades, setTrades] = useState(loadTrades());
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = () => setTrades(loadTrades());

  const open = useMemo(() => trades.filter((t) => t.status === "OPEN"), [trades]);
  const closed = useMemo(() => trades.filter((t) => t.status === "CLOSED"), [trades]);

  const sysStats = useMemo(() => laneStats(closed.filter((t) => laneOf(t) === "SYSTEM")), [closed]);
  const discStats = useMemo(() => laneStats(closed.filter((t) => laneOf(t) === "DISCRETIONARY")), [closed]);

  function downloadJSON() {
    const blob = new Blob([exportTradesJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadObsidianMd(t) {
    const md = tradeToObsidianMarkdown(t);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = obsidianFilename(t);
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAllObsidianMd() {
    if (!trades.length) return;
    // Single combined Markdown with separators — paste into vault and split, or
    // use Obsidian's "import" workflow.
    const combined = trades.map((t) => `\n\n<!-- file: ${obsidianFilename(t)} -->\n${tradeToObsidianMarkdown(t)}`).join("\n");
    const blob = new Blob([combined], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades-bundle-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyMd(t) {
    navigator.clipboard.writeText(tradeToObsidianMarkdown(t)).then(() => {
      setNotice(`Copied ${obsidianFilename(t)} to clipboard.`);
      setTimeout(() => setNotice(""), 3000);
    });
  }

  function handleImport(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const n = importTrades(String(reader.result));
        refresh();
        setNotice(`Imported ${n} trades.`);
        setTimeout(() => setNotice(""), 3000);
      } catch (err) {
        setNotice(`Import error: ${err.message}`);
        setTimeout(() => setNotice(""), 5000);
      }
    };
    reader.readAsText(f);
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Journal · Crypto System v2.0"
        title="Trade log"
        actions={
          <>
            <button style={ui.btn} onClick={downloadJSON} type="button">Export JSON</button>
            <label role="button" style={ui.btn}>
              Import JSON
              <input type="file" accept="application/json" onChange={handleImport} style={{ display: "none" }} />
            </label>
            <button style={ui.btn} onClick={downloadAllObsidianMd} type="button">Export all to MD</button>
            <button style={ui.btnPrimary} onClick={() => setShowNew(true)} type="button">New trade</button>
          </>
        }
      >
        <p className="muted">
          Persisted in this browser. Every trade exports as Obsidian-flavored Markdown
          with YAML frontmatter — drop the file into your vault and your Memory Wiki
          indexes it.
        </p>
      </PageHeader>

      {notice ? <div style={ui.bannerGood}>{notice}</div> : null}

      <section style={ui.panel}>
        <div style={styles.laneHead}>
          <h2 style={ui.h2}>System lane</h2>
          <span style={ui.small}>Mechanical v2.0 — followed to the dot</span>
        </div>
        <div style={ui.tiles}>
          <Tile label="Open" value={String(open.filter((t) => laneOf(t) === "SYSTEM").length)} />
          <Tile label="Closed" value={String(sysStats.count)} />
          <Tile label="Wins / Losses" value={`${sysStats.wins} / ${sysStats.losses}`} />
          <Tile label="Win rate" value={sysStats.count ? `${((sysStats.wins / sysStats.count) * 100).toFixed(1)}%` : "-"} />
          <Tile label="Realized PnL" value={`${fmt(sysStats.pnl, 2)} USDT`} good={sysStats.pnl > 0} bad={sysStats.pnl < 0} />
          <Tile label="Avg R" value={fmt(sysStats.avgR, 2)} />
        </div>
      </section>
      <section style={ui.panel}>
        <div style={styles.laneHead}>
          <h2 style={ui.h2}>Discretionary lane</h2>
          <span style={ui.small}>Market Cipher / your judgment</span>
        </div>
        <div style={ui.tiles}>
          <Tile label="Open" value={String(open.filter((t) => laneOf(t) === "DISCRETIONARY").length)} />
          <Tile label="Closed" value={String(discStats.count)} />
          <Tile label="Wins / Losses" value={`${discStats.wins} / ${discStats.losses}`} />
          <Tile label="Win rate" value={discStats.count ? `${((discStats.wins / discStats.count) * 100).toFixed(1)}%` : "-"} />
          <Tile label="Realized PnL" value={`${fmt(discStats.pnl, 2)} USDT`} good={discStats.pnl > 0} bad={discStats.pnl < 0} />
          <Tile label="Avg R" value={fmt(discStats.avgR, 2)} />
        </div>
      </section>

      <Section title="Open positions">
        {open.length === 0 ? <Empty text="No open positions." /> : (
          <TradeTable
            trades={open}
            onClose={(t) => setEditing({ ...t, _mode: "close" })}
            onEdit={(t) => setEditing({ ...t, _mode: "edit" })}
            onDelete={(t) => { if (confirm("Delete this trade?")) { deleteTrade(t.id); refresh(); } }}
            onMd={copyMd}
            onMdFile={downloadObsidianMd}
          />
        )}
      </Section>

      <Section title="Closed">
        {closed.length === 0 ? <Empty text="No closed trades yet." /> : (
          <TradeTable
            trades={closed.slice().reverse()}
            onClose={null}
            onEdit={(t) => setEditing({ ...t, _mode: "edit" })}
            onDelete={(t) => { if (confirm("Delete this trade?")) { deleteTrade(t.id); refresh(); } }}
            onMd={copyMd}
            onMdFile={downloadObsidianMd}
          />
        )}
      </Section>

      {showNew ? (
        <NewTradeModal
          onClose={() => setShowNew(false)}
          onSave={(t) => { addTrade(t); refresh(); setShowNew(false); }}
        />
      ) : null}

      {editing ? (
        <EditModal
          trade={editing}
          mode={editing._mode}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            if (editing._mode === "close") {
              closeTrade(editing.id, patch);
            } else {
              updateTrade(editing.id, patch);
            }
            refresh();
            setEditing(null);
          }}
        />
      ) : null}
    </Page>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <h2 style={ui.h2}>{title}</h2>
      {children}
    </section>
  );
}

function Empty({ text }) {
  return <div style={ui.empty}>{text}</div>;
}

function TradeTable({ trades, onClose, onEdit, onDelete, onMd, onMdFile }) {
  return (
    <div style={ui.tableWrap}>
      <table style={ui.table}>
        <thead>
          <tr>
            <th style={styles.th}>Date</th>
            <th style={styles.th}>Lane</th>
            <th style={styles.th}>Asset</th>
            <th style={styles.th}>Dir</th>
            <th style={styles.th}>Entry</th>
            <th style={styles.th}>Stop</th>
            <th style={styles.th}>Qty</th>
            <th style={styles.th}>Risk $</th>
            <th style={styles.th}>Exit</th>
            <th style={styles.th}>PnL</th>
            <th style={styles.th}>R</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const pnl = t.exit ? (t.direction === "LONG" ? 1 : -1) * t.entry.qty * (t.exit.price - t.entry.price) : null;
            const r = pnl !== null && t.entry?.riskDollar ? pnl / t.entry.riskDollar : null;
            return (
              <tr key={t.id}>
                <td style={styles.td}>{ymd(t.entry?.time)}</td>
                <td style={styles.td}>
                  <span style={{ ...ui.badge, background: laneOf(t) === "SYSTEM" ? TONE.info.bg : TONE.accent.bg, color: laneOf(t) === "SYSTEM" ? TONE.info.fg : TONE.accent.fg }}>
                    {laneOf(t) === "SYSTEM" ? "SYS" : "DISC"}
                  </span>
                </td>
                <td style={{ ...styles.td, fontFamily: T.body, fontWeight: 600 }}>{t.asset}</td>
                <td style={{ ...styles.td, color: t.direction === "LONG" ? T.up : T.down }}>{t.direction}</td>
                <td style={styles.td}>{fmt(t.entry?.price, 4)}</td>
                <td style={styles.td}>{fmt(t.entry?.stop, 4)}</td>
                <td style={styles.td}>{fmt(t.entry?.qty, 6)}</td>
                <td style={styles.td}>{fmt(t.entry?.riskDollar, 2)}</td>
                <td style={styles.td}>{t.exit ? `${ymd(t.exit.time)} @ ${fmt(t.exit.price, 4)}` : "-"}</td>
                <td style={{ ...styles.td, color: pnl > 0 ? T.up : pnl < 0 ? T.down : T.muted }}>{fmt(pnl, 2)}</td>
                <td style={styles.td}>{fmt(r, 2)}</td>
                <td style={styles.td}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {onClose ? <button style={ui.btnSmall} onClick={() => onClose(t)} type="button">close</button> : null}
                    <button style={ui.btnSmall} onClick={() => onEdit(t)} type="button">edit</button>
                    <button style={ui.btnSmall} onClick={() => onMd(t)} type="button" title="Copy Markdown">md</button>
                    <button style={ui.btnSmall} onClick={() => onMdFile(t)} type="button" title="Download .md">↓</button>
                    <button style={ui.btnSmallDanger} onClick={() => onDelete(t)} type="button">×</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NewTradeModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    asset: "BTC", direction: "LONG",
    lane: "system",
    entryDate: new Date().toISOString().slice(0, 10),
    price: "", stop: "", qty: "", riskDollar: "", leverage: "",
    regimeState: "LONG_OK", weeklySma: "", weeklyHist: "", weeklyAdx: "", weeklyRsi: "",
    dailyClose: "", dailyRsi: "", dailyAtr: "", signalReason: "",
    notes: "",
  });

  function update(k, v) { setForm((p) => ({ ...p, [k]: v })); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  function save() {
    const entryTime = Math.floor(new Date(form.entryDate + "T12:00:00Z").getTime() / 1000);
    const trade = {
      asset: form.asset,
      direction: form.direction,
      entry: {
        time: entryTime,
        price: num(form.price),
        stop: num(form.stop),
        qty: num(form.qty),
        riskDollar: num(form.riskDollar),
        leverage: num(form.leverage),
      },
      regimeSnapshot: {
        state: form.regimeState,
        sma: num(form.weeklySma),
        hist: num(form.weeklyHist),
        adx: num(form.weeklyAdx),
        rsi: num(form.weeklyRsi),
      },
      signalSnapshot: {
        action: form.direction,
        reason: form.signalReason,
        close: num(form.dailyClose),
        rsi: num(form.dailyRsi),
        atr: num(form.dailyAtr),
      },
      notes: form.notes,
      systemSource: form.lane,
    };
    onSave(trade);
  }

  return (
    <Modal title="New trade" onClose={onClose} onSave={save}>
      <div style={modalStyles.grid2}>
        <Field label="Asset">
          <select value={form.asset} onChange={(e) => update("asset", e.target.value)} style={modalStyles.input}>
            {ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <select value={form.direction} onChange={(e) => update("direction", e.target.value)} style={modalStyles.input}>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </Field>
        <Field label="Lane">
          <select value={form.lane} onChange={(e) => update("lane", e.target.value)} style={modalStyles.input}>
            <option value="system">SYSTEM (scanner signal)</option>
            <option value="discretionary">DISCRETIONARY (Cipher / judgment)</option>
          </select>
        </Field>
        <Field label="Entry date"><input type="date" value={form.entryDate} onChange={(e) => update("entryDate", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Entry price"><input value={form.price} onChange={(e) => update("price", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Stop price"><input value={form.stop} onChange={(e) => update("stop", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Quantity"><input value={form.qty} onChange={(e) => update("qty", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Risk $"><input value={form.riskDollar} onChange={(e) => update("riskDollar", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Leverage"><input value={form.leverage} onChange={(e) => update("leverage", e.target.value)} style={modalStyles.input} /></Field>
      </div>

      <div style={{ ...ui.eyebrow, marginTop: 18, marginBottom: 8 }}>Weekly regime (at entry)</div>
      <div style={modalStyles.grid4}>
        <Field label="State">
          <select value={form.regimeState} onChange={(e) => update("regimeState", e.target.value)} style={modalStyles.input}>
            {["LONG_OK", "SHORT_OK", "FLAT", "WARMUP"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="50W SMA"><input value={form.weeklySma} onChange={(e) => update("weeklySma", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="MACD hist"><input value={form.weeklyHist} onChange={(e) => update("weeklyHist", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="ADX"><input value={form.weeklyAdx} onChange={(e) => update("weeklyAdx", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="RSI"><input value={form.weeklyRsi} onChange={(e) => update("weeklyRsi", e.target.value)} style={modalStyles.input} /></Field>
      </div>

      <div style={{ ...ui.eyebrow, marginTop: 18, marginBottom: 8 }}>Daily signal (at entry)</div>
      <div style={modalStyles.grid4}>
        <Field label="Close"><input value={form.dailyClose} onChange={(e) => update("dailyClose", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="RSI(14)"><input value={form.dailyRsi} onChange={(e) => update("dailyRsi", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="ATR(14)"><input value={form.dailyAtr} onChange={(e) => update("dailyAtr", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Reason / setup"><input value={form.signalReason} onChange={(e) => update("signalReason", e.target.value)} style={modalStyles.input} /></Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} style={{ ...modalStyles.input, minHeight: 80 }} />
        </Field>
      </div>
    </Modal>
  );
}

function EditModal({ trade, mode, onClose, onSave }) {
  const isClose = mode === "close";
  const [form, setForm] = useState({
    exitDate: trade.exit?.time ? new Date(trade.exit.time * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    exitPrice: trade.exit?.price ?? "",
    exitReason: trade.exit?.reason ?? "trailing stop hit",
    notes: trade.notes ?? "",
  });

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  function save() {
    if (isClose) {
      onSave({
        time: Math.floor(new Date(form.exitDate + "T12:00:00Z").getTime() / 1000),
        price: num(form.exitPrice),
        reason: form.exitReason,
      });
    } else {
      onSave({ notes: form.notes });
    }
  }

  return (
    <Modal title={isClose ? "Close trade" : "Edit trade"} onClose={onClose} onSave={save}>
      {isClose ? (
        <>
          <div style={modalStyles.grid2}>
            <Field label="Exit date"><input type="date" value={form.exitDate} onChange={(e) => setForm({ ...form, exitDate: e.target.value })} style={modalStyles.input} /></Field>
            <Field label="Exit price"><input value={form.exitPrice} onChange={(e) => setForm({ ...form, exitPrice: e.target.value })} style={modalStyles.input} /></Field>
          </div>
          <Field label="Reason">
            <select value={form.exitReason} onChange={(e) => setForm({ ...form, exitReason: e.target.value })} style={modalStyles.input}>
              <option value="trailing stop hit">trailing stop hit</option>
              <option value="regime flip">regime flip</option>
              <option value="discretionary exit">discretionary exit</option>
              <option value="manual stop">manual stop</option>
            </select>
          </Field>
        </>
      ) : (
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ ...modalStyles.input, minHeight: 120 }} />
        </Field>
      )}
    </Modal>
  );
}

function Modal({ title, children, onClose, onSave }) {
  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.modalHead}>
          <h2 style={ui.h2}>{title}</h2>
          <button style={modalStyles.closeX} onClick={onClose} type="button">×</button>
        </div>
        <div style={{ padding: 18, display: "grid", gap: 12 }}>{children}</div>
        <div style={modalStyles.modalFoot}>
          <button style={ui.btn} onClick={onClose} type="button">Cancel</button>
          <button style={ui.btnPrimary} onClick={onSave} type="button">Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={ui.fieldWrap}>
      <label style={ui.label}>{label}</label>
      {children}
    </div>
  );
}

const styles = {
  laneHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px" },
  th: ui.th,
  td: ui.td,
};

const modalStyles = {
  // The modal sits outside <Page>'s content column but inside .ns, so the
  // theme variables still resolve.
  overlay: { position: "fixed", inset: 0, background: "#000b", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 12px 12px", zIndex: 200 },
  modal: { width: 720, maxWidth: "100%", maxHeight: "84vh", overflow: "auto", borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, boxShadow: "0 30px 80px #0009" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${T.line}` },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 18px", borderTop: `1px solid ${T.line}` },
  closeX: { background: "transparent", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 4px" },
  input: ui.input,
  grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 },
};
