#!/usr/bin/env node
/**
 * Installs (or removes) the macOS launchd agent that runs the Narrative Scout
 * every hour: news on every run, the full market scan and test-book update
 * once per UTC day.
 *
 *   node scripts/scout-install.mjs              # install + start
 *   node scripts/scout-install.mjs --uninstall  # stop + remove
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LABEL = "com.cryptoentry.scout";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(ROOT, "data", "scout");

if (process.platform !== "darwin") {
  console.error("This installer targets macOS launchd. On Linux, add a crontab entry:\n" +
    `  10 * * * * cd ${ROOT} && ${process.execPath} scripts/scout.mjs >> data/scout/cron.log 2>&1`);
  process.exit(1);
}

const uninstall = process.argv.includes("--uninstall");
try { execFileSync("launchctl", ["unload", PLIST], { stdio: "ignore" }); } catch { /* not loaded */ }

if (uninstall) {
  if (existsSync(PLIST)) rmSync(PLIST);
  console.log(`Removed ${LABEL}. The Scout no longer runs automatically.`);
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
    <string>${join(ROOT, "scripts", "scout.mjs")}</string>
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
  `Installed ${LABEL} — the Scout now runs every hour and once right now.`,
  ``,
  `Where to look:`,
  `  http://localhost:5173/#/scout  the SCOUT tab`,
  `  data/scout/status.md           text summary of the latest scan`,
  `  data/scout/journal.jsonl       every daily pick, watchlist and reject (the track record)`,
  `  data/scout/launchd.log         raw run output (for debugging)`,
  ``,
  `Alerts (picks, exits, Grade-A news on watched coins) go to Notification Center`,
  `and to your phone if data/paper/ntfy.txt holds your ntfy topic.`,
  ``,
  `Optional:`,
  `  Claude explainers:  put your Anthropic API key in data/scout/anthropic.txt`,
  `  CoinGecko demo key: put it in data/scout/coingecko.txt (higher rate limits)`,
  ``,
  `To stop it:  npm run scout:uninstall`,
].join("\n"));
