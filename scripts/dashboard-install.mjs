#!/usr/bin/env node
/**
 * Installs (or removes) a macOS launchd agent that keeps the web dashboard
 * running at http://localhost:5173 permanently — no Terminal window needed.
 * KeepAlive restarts it if it crashes; it comes back after reboots.
 *
 *   node scripts/dashboard-install.mjs              # install + start
 *   node scripts/dashboard-install.mjs --uninstall  # stop + remove
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LABEL = "com.cryptoentry.dashboard";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(ROOT, "data", "paper");
const VITE = join(ROOT, "node_modules", "vite", "bin", "vite.js");

if (process.platform !== "darwin") {
  console.error("This installer targets macOS launchd. On Linux use a systemd unit or just run: npm run dev");
  process.exit(1);
}

const uninstall = process.argv.includes("--uninstall");
try { execFileSync("launchctl", ["unload", PLIST], { stdio: "ignore" }); } catch { /* not loaded */ }

if (uninstall) {
  if (existsSync(PLIST)) rmSync(PLIST);
  console.log(`Removed ${LABEL}. The dashboard no longer auto-runs; use "npm run dev" manually.`);
  process.exit(0);
}

if (!existsSync(VITE)) {
  console.error("vite not found — run `npm install` in the project folder first.");
  process.exit(1);
}

mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(dirname(PLIST), { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${VITE}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${join(LOG_DIR, "dashboard.log")}</string>
  <key>StandardErrorPath</key><string>${join(LOG_DIR, "dashboard.log")}</string>
</dict>
</plist>
`;

writeFileSync(PLIST, plist);
execFileSync("launchctl", ["load", "-w", PLIST]);

console.log([
  `Installed ${LABEL} — the dashboard now runs permanently in the background.`,
  ``,
  `Open http://localhost:5173 in your browser ANY time — no Terminal needed.`,
  `It restarts automatically after crashes and reboots.`,
  ``,
  `Log: data/paper/dashboard.log`,
  `To stop it:  npm run dashboard:uninstall`,
].join("\n"));
