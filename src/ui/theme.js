import "./theme.css";

/**
 * Inline-style kit for the tabs that style elements with style={...}
 * (Checker, Scanner, Backtest, Trade Log, Paper). It mirrors the Narrative
 * Scout page's look so every tab reads as one app. Values are CSS variables
 * defined on .ns in theme.css, so the page root must carry className="ns"
 * (use <Page> from ./Page.jsx).
 */
export const T = {
  bg: "var(--bg)", panel: "var(--panel)", ink: "var(--ink)", muted: "var(--muted)", line: "var(--line)",
  accent: "var(--accent)", accentSoft: "var(--accent-soft)",
  up: "var(--up)", upBg: "var(--up-bg)", down: "var(--down)", downBg: "var(--down-bg)",
  flatBg: "var(--flat-bg)", warn: "var(--warn)", warnBg: "var(--warn-bg)", info: "var(--info)", infoBg: "var(--info-bg)",
  display: "var(--display)", body: "var(--body)", mono: "var(--mono)",
};

// Canvas-drawn charts (lightweight-charts) can't read CSS variables, so they
// get the same palette as literal values. Keep in sync with theme.css.
export const HEX = {
  bg: "#0f151b", panel: "#161f28", ink: "#e3e9ee", muted: "#93a1ae", line: "#2a3643",
  accent: "#e89a45", up: "#6fd19c", down: "#f08b80", info: "#8fc8ff",
};
export const CHART_FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

// Semantic colour pairs for badges and chips.
export const TONE = {
  up: { bg: T.upBg, fg: T.up },
  down: { bg: T.downBg, fg: T.down },
  warn: { bg: T.warnBg, fg: T.warn },
  info: { bg: T.infoBg, fg: T.info },
  accent: { bg: T.accentSoft, fg: T.accent },
  flat: { bg: T.flatBg, fg: T.muted },
};

/** Green for gains, red for losses, muted for zero/unknown. */
export const signColor = (x) => (x > 0 ? T.up : x < 0 ? T.down : T.muted);

const field = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6,
  border: `1px solid ${T.line}`, background: T.bg, color: T.ink,
  fontFamily: T.body, fontSize: 14, lineHeight: 1.4,
};

export const ui = {
  // Content column inside <Page>.
  wrap: { maxWidth: 1180, margin: "0 auto", padding: "26px 16px 56px", display: "grid", gap: 18, minWidth: 0 },

  panel: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: 18, display: "grid", gap: 12, minWidth: 0, alignContent: "start" },
  // A box nested inside a panel (sits one step darker).
  inset: { background: T.bg, border: `1px solid ${T.line}`, borderRadius: 6, padding: 12, minWidth: 0 },

  h2: { fontFamily: T.display, fontSize: 21, fontWeight: 600, margin: 0, color: T.ink },
  eyebrow: { fontFamily: T.mono, fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: T.accent },
  muted: { color: T.muted },
  small: { fontSize: 12.5, color: T.muted, lineHeight: 1.5 },
  mono: { fontFamily: T.mono, fontVariantNumeric: "tabular-nums" },

  btn: {
    fontFamily: T.mono, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase",
    color: T.ink, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 6,
    padding: "8px 14px", cursor: "pointer", whiteSpace: "nowrap", lineHeight: 1.4,
  },
  // The page's main action.
  btnPrimary: {
    fontFamily: T.mono, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase",
    color: T.accent, background: T.accentSoft, border: `1px solid ${T.accent}`, borderRadius: 6,
    padding: "8px 14px", cursor: "pointer", whiteSpace: "nowrap", lineHeight: 1.4, fontWeight: 500,
  },
  btnSmall: {
    fontFamily: T.mono, fontSize: 11, color: T.ink, background: T.panel, border: `1px solid ${T.line}`,
    borderRadius: 4, padding: "2px 8px", cursor: "pointer", lineHeight: 1.5,
  },
  btnSmallDanger: {
    fontFamily: T.mono, fontSize: 11, color: T.down, background: T.downBg, border: `1px solid ${T.down}`,
    borderRadius: 4, padding: "2px 8px", cursor: "pointer", lineHeight: 1.5,
  },

  // Form fields: a responsive row of labelled controls.
  controls: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 },
  fieldWrap: { display: "grid", gap: 6, alignContent: "start", minWidth: 0 },
  label: { fontFamily: T.mono, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: T.muted },
  input: field,
  readonly: { ...field, background: T.flatBg, borderColor: "transparent", fontFamily: T.mono },
  hint: { fontSize: 12, color: T.muted, lineHeight: 1.45 },

  chip: {
    display: "inline-block", fontFamily: T.mono, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase",
    padding: "2px 8px", borderRadius: 999, border: `1px solid ${T.line}`, color: T.muted, whiteSpace: "nowrap",
  },
  badge: {
    display: "inline-block", fontFamily: T.mono, fontSize: 11, padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap",
  },

  // Metric tiles (label over a big number).
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 },
  tile: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 6, padding: "10px 12px", display: "grid", gap: 2, minWidth: 0 },
  tileLabel: { fontSize: 12, color: T.muted },
  tileValue: { fontFamily: T.mono, fontSize: 21, color: T.ink, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" },
  tileSub: { fontFamily: T.mono, fontSize: 11, color: T.muted },

  banner: { borderRadius: 6, padding: "10px 14px", fontSize: 13.5, border: "1px solid", color: T.ink },
  bannerWarn: { borderRadius: 6, padding: "10px 14px", fontSize: 13.5, border: `1px solid ${T.warn}`, background: T.warnBg, color: T.ink },
  bannerBad: { borderRadius: 6, padding: "10px 14px", fontSize: 13.5, border: `1px solid ${T.down}`, background: T.downBg, color: T.ink },
  bannerGood: { borderRadius: 6, padding: "10px 14px", fontSize: 13.5, border: `1px solid ${T.up}`, background: T.upBg, color: T.ink },

  empty: { padding: 22, borderRadius: 8, border: `1px dashed ${T.line}`, textAlign: "center", color: T.muted, fontSize: 13.5, background: T.panel },

  tableWrap: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, overflow: "auto", minWidth: 0 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    fontFamily: T.mono, fontWeight: 500, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase",
    color: T.muted, textAlign: "left", padding: "9px 10px", borderBottom: `1px solid ${T.line}`,
    whiteSpace: "nowrap", background: T.panel, position: "sticky", top: 0,
  },
  td: {
    padding: "8px 10px", borderBottom: `1px solid ${T.line}`, whiteSpace: "nowrap", verticalAlign: "middle",
    fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 12.5,
  },

  foot: { fontSize: 12.5, color: T.muted, lineHeight: 1.5 },
};
