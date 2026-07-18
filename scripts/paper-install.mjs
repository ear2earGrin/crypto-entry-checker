#!/usr/bin/env node
/**
 * Installs (or removes) the macOS launchd agent that runs the paper-trading
 * daemon every hour, automatically, forever — including after reboots.
 *
 *   node scripts/paper-install.mjs              # install + start
 *   node scripts/paper-install.mjs --uninstall  # stop + remove
 *
 * launchd (not cron) because it also fires on wake-from-sleep, so a Mac that
 * napped still catches up on the next hour boundary.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LABEL = "com.cryptoentry.paper";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(ROOT, "data", "paper");

if (process.platform !== "darwin") {
  console.error("This installer targets macOS launchd. On Linux, add a crontab entry:\n" +
    `  5 * * * * cd ${ROOT} && ${process.execPath} scripts/papertrade.mjs >> data/paper/cron.log 2>&1`);
  process.exit(1);
}

const uninstall = process.argv.includes("--uninstall");

try { execFileSync("launchctl", ["unload", PLIST], { stdio: "ignore" }); } catch { /* not loaded */ }

if (uninstall) {
  if (existsSync(PLIST)) rmSync(PLIST);
  console.log(`Removed ${LABEL}. The paper robot will no longer run automatically.`);
  process.exit(0);
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
    <string>${join(ROOT, "scripts", "papertrade.mjs")}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${join(LOG_DIR, "launchd.log")}</string>
  <key>StandardErrorPath</key><string>${join(LOG_DIR, "launchd.log")}</string>
</dict>
</plist>
`;

writeFileSync(PLIST, plist);
execFileSync("launchctl", ["load", "-w", PLIST]);

console.log([
  `Installed ${LABEL} — the paper-trading robot now runs every hour, automatically,`,
  `and immediately once right now. It survives reboots.`,
  ``,
  `Where to look:`,
  `  data/paper/status.md     current portfolio (open positions, PnL)`,
  `  data/paper/paper-log.md  every entry/exit/stop-raise, timestamped`,
  `  data/paper/launchd.log   raw run output (for debugging)`,
  ``,
  `Notifications appear in macOS Notification Center when a trade opens/closes.`,
  ``,
  `IMPORTANT: keep the Mac mini awake. System Settings → Energy → enable`,
  `"Prevent automatic sleeping" (or at least allow wake for network access).`,
  ``,
  `To stop it:  npm run paper:uninstall`,
].join("\n"));
